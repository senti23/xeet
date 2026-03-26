/**
 * Download creator profile pictures to web/public/avatars/ for CORS-safe canvas rendering.
 * Usage: npx tsx scripts/download-avatars.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const AVATARS_DIR = resolve(REPO_ROOT, 'web/public/avatars');

interface CreatorProfile {
  avatar: string;
  xeetBalance: number;
}

async function main() {
  const profiles: Record<string, CreatorProfile> = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'creators-profiles.json'), 'utf-8'),
  );

  if (!existsSync(AVATARS_DIR)) {
    mkdirSync(AVATARS_DIR, { recursive: true });
  }

  const handles = Object.keys(profiles);
  console.log(`Found ${handles.length} creators to download avatars for`);

  let success = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < handles.length; i++) {
    const handle = handles[i];
    const outPath = resolve(AVATARS_DIR, `${handle}.jpg`);

    if (existsSync(outPath)) {
      skipped++;
      continue;
    }

    const url = profiles[handle].avatar;
    if (!url) {
      failed++;
      continue;
    }

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(outPath, buf);
      success++;
    } catch (err: any) {
      // Try _normal fallback if the URL had a higher-res variant
      const normalUrl = url.replace(/_400x400|_200x200/, '_normal');
      if (normalUrl !== url) {
        try {
          const res2 = await fetch(normalUrl, { signal: AbortSignal.timeout(10000) });
          if (res2.ok) {
            const buf = Buffer.from(await res2.arrayBuffer());
            writeFileSync(outPath, buf);
            success++;
            continue;
          }
        } catch {}
      }
      console.log(`  FAILED: ${handle} — ${err.message}`);
      failed++;
    }

    if ((success + failed) % 50 === 0) {
      console.log(`  Progress: ${success + failed + skipped}/${handles.length} (${success} downloaded, ${skipped} skipped, ${failed} failed)`);
    }

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\nDone! ${success} downloaded, ${skipped} already existed, ${failed} failed`);
}

main().catch(console.error);
