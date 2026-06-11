/**
 * Push token-map additions into xeet.db token_map.
 *
 * Reads analysis/megaeth-verify/token-map-additions.json and INSERT OR IGNOREs
 * every row in a single transaction. Existing rows are never modified.
 *
 * Usage:
 *   npx tsx scripts/push-token-map-additions.ts            # dry run (prints what would change)
 *   npx tsx scripts/push-token-map-additions.ts --confirm  # apply
 *   DB_PATH=/data/xeet.db npx tsx scripts/push-token-map-additions.ts --confirm  # Railway volume
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../src/db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
// server/data-seed/ ships inside the deployed service; analysis/ may not (monorepo root setting).
const defaultAdditions = existsSync(resolve(__dirname, '../data-seed/token-map-additions.json'))
  ? resolve(__dirname, '../data-seed/token-map-additions.json')
  : resolve(REPO_ROOT, 'analysis/megaeth-verify/token-map-additions.json');

const additionsPath = process.argv.find((a) => a.endsWith('.json')) ?? defaultAdditions;
const confirm = process.argv.includes('--confirm');

interface Addition {
  token_id: string;
  creator_handle: string;
  rarity: string;
  name: string | null;
  image_url: string | null;
}

const additions: Addition[] = JSON.parse(readFileSync(additionsPath, 'utf-8'));
const db = getDb();

const before = (db.prepare('SELECT COUNT(*) AS n FROM token_map').get() as { n: number }).n;
const existing = new Set(
  (db.prepare('SELECT token_id FROM token_map').all() as Array<{ token_id: string }>).map((r) => String(r.token_id)),
);
const newRows = additions.filter((a) => !existing.has(String(a.token_id)));

console.log(`token_map rows before: ${before}`);
console.log(`additions in file:     ${additions.length} (${additionsPath})`);
console.log(`actually new:          ${newRows.length}`);

if (!confirm) {
  console.log('\nDry run — pass --confirm to apply.');
  process.exit(0);
}

const insert = db.prepare(
  'INSERT OR IGNORE INTO token_map (token_id, creator_handle, rarity, name, image_url) VALUES (?, ?, ?, ?, ?)',
);
const tx = db.transaction((rows: Addition[]) => {
  for (const a of rows) {
    insert.run(String(a.token_id), a.creator_handle.toLowerCase(), a.rarity, a.name ?? null, a.image_url ?? null);
  }
});
tx(additions);

const after = (db.prepare('SELECT COUNT(*) AS n FROM token_map').get() as { n: number }).n;
console.log(`token_map rows after:  ${after} (+${after - before})`);
