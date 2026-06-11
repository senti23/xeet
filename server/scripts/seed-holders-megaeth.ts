/**
 * Seed card_holders from a verified MegaETH holders snapshot (the chain cutover).
 *
 * In ONE transaction:
 *   - DELETE FROM card_holders (the old Abstract rows)
 *   - insert every (wallet, token_id, qty, creator, rarity) row from the snapshot
 *   - holder_sync_meta: last_synced_block = snapshot watermark, last_full_sync = now, chain = '4326'
 *   - pipeline_meta: os_backfill_complete = 'false' (next boot re-runs the per-token
 *     OpenSea sale backfill against MegaETH; dedup-safe)
 *
 * The watermark comes from m1-summary.json next to the snapshot (or --block=N).
 * After seeding, the untouched refreshHolders() continues incrementally on chainid 4326.
 *
 * Usage:
 *   npx tsx scripts/seed-holders-megaeth.ts            # dry run
 *   npx tsx scripts/seed-holders-megaeth.ts --confirm  # apply
 *   DB_PATH=/data/xeet.db npx tsx scripts/seed-holders-megaeth.ts --confirm  # Railway volume
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../src/db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
// server/data-seed/ ships inside the deployed service; analysis/ may not (monorepo root setting).
const SEED_DIR = existsSync(resolve(__dirname, '../data-seed/holders-snapshot.json'))
  ? resolve(__dirname, '../data-seed')
  : resolve(REPO_ROOT, 'analysis/megaeth-verify');

const snapshotPath = process.argv.find((a) => a.endsWith('.json') && !a.includes('m1-summary'))
  ?? resolve(SEED_DIR, 'holders-snapshot.json');
const confirm = process.argv.includes('--confirm');

const blockArg = process.argv.find((a) => a.startsWith('--block='));
let watermark: number | null = blockArg ? parseInt(blockArg.split('=')[1], 10) : null;
if (watermark === null) {
  const summaryPath = resolve(dirname(snapshotPath), 'm1-summary.json');
  if (!existsSync(summaryPath)) {
    console.error(`No --block=N given and ${summaryPath} not found — cannot determine watermark.`);
    process.exit(1);
  }
  watermark = JSON.parse(readFileSync(summaryPath, 'utf-8')).highest_block as number;
}

interface HoldingEntry {
  token_id: string;
  creator: string | null;
  rarity: string | null;
  qty: number;
}
const snapshot: Record<string, HoldingEntry[]> = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

// Pre-flight: every row needs creator+rarity (NOT NULL + rarity CHECK in schema)
let rows = 0;
let cards = 0;
const badRows: Array<{ wallet: string; token_id: string }> = [];
for (const [wallet, holdings] of Object.entries(snapshot)) {
  for (const h of holdings) {
    rows++;
    cards += h.qty;
    if (!h.creator || !['common', 'rare', 'legendary'].includes(h.rarity ?? '')) {
      badRows.push({ wallet, token_id: h.token_id });
    }
  }
}

const db = getDb();
const before = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(quantity),0) AS q FROM card_holders').get() as { n: number; q: number };

console.log(`snapshot:        ${snapshotPath}`);
console.log(`watermark block: ${watermark}`);
console.log(`wallets:         ${Object.keys(snapshot).length}`);
console.log(`rows to insert:  ${rows} (${cards} cards)`);
console.log(`rows missing creator/rarity: ${badRows.length}${badRows.length ? ' — ' + JSON.stringify(badRows.slice(0, 5)) : ''}`);
console.log(`card_holders now: ${before.n} rows / ${before.q} cards (will be DELETED)`);

if (badRows.length > 0) {
  console.error('\nABORT: snapshot has unmapped rows — re-run m1-enrich-snapshot.mjs first.');
  process.exit(1);
}
if (!confirm) {
  console.log('\nDry run — pass --confirm to apply.');
  process.exit(0);
}

const insertHolder = db.prepare(
  `INSERT INTO card_holders (wallet_address, token_id, quantity, creator_handle, rarity, last_updated)
   VALUES (?, ?, ?, ?, ?, datetime('now'))`,
);
const upsertSyncMeta = db.prepare(
  'INSERT INTO holder_sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
);
const upsertPipelineMeta = db.prepare(
  `INSERT INTO pipeline_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
);

const tx = db.transaction(() => {
  db.prepare('DELETE FROM card_holders').run();
  for (const [wallet, holdings] of Object.entries(snapshot)) {
    for (const h of holdings) {
      insertHolder.run(wallet.toLowerCase(), String(h.token_id), h.qty, h.creator!.toLowerCase(), h.rarity);
    }
  }
  upsertSyncMeta.run('last_synced_block', String(watermark));
  upsertSyncMeta.run('last_full_sync', new Date().toISOString());
  upsertSyncMeta.run('chain', '4326');
  upsertPipelineMeta.run('os_backfill_complete', 'false');
});
tx();

const after = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(quantity),0) AS q FROM card_holders').get() as { n: number; q: number };
console.log(`\nSeeded: ${after.n} rows / ${after.q} cards. Watermark set to block ${watermark}. os_backfill_complete reset.`);
