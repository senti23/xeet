// M1 — Enrich holders-snapshot.json with token-map-additions, record highest block.
// Re-enriches creator:null rows from token_map (xeet.db, read-only) ∪ token-map-additions.json.
// Writes holders-snapshot.json in place + m1-summary.json (highest_block = Phase 2 seed watermark).

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const snapshotPath = path.join(__dirname, 'holders-snapshot.json');
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const rawEvents = JSON.parse(fs.readFileSync(path.join(__dirname, 'megaeth-raw-events.json'), 'utf8'));
const additions = JSON.parse(fs.readFileSync(path.join(__dirname, 'token-map-additions.json'), 'utf8'));

// token_map from local xeet.db (read-only)
const dbRows = JSON.parse(
  execSync(`sqlite3 -json "${path.join(REPO_ROOT, 'xeet.db')}" "SELECT token_id, creator_handle, rarity FROM token_map;"`).toString()
);

const tokenMap = new Map();
for (const r of dbRows) tokenMap.set(String(r.token_id), { creator: r.creator_handle, rarity: r.rarity });
for (const a of additions) tokenMap.set(String(a.token_id), { creator: a.creator_handle, rarity: a.rarity });

let enriched = 0;
let stillUnmapped = 0;
let totalCards = 0;
const rarityTotals = { common: 0, rare: 0, legendary: 0, unknown: 0 };

for (const holdings of Object.values(snapshot)) {
  for (const h of holdings) {
    totalCards += h.qty;
    if (h.creator === null) {
      const meta = tokenMap.get(String(h.token_id));
      if (meta) {
        h.creator = meta.creator;
        h.rarity = meta.rarity;
        enriched++;
      } else {
        stillUnmapped++;
      }
    }
    rarityTotals[h.rarity || 'unknown'] = (rarityTotals[h.rarity || 'unknown'] || 0) + h.qty;
  }
}

const highestBlock = rawEvents.reduce((m, e) => Math.max(m, parseInt(e.blockNumber, 10)), 0);
const distinctIds = new Set(rawEvents.map(e => String(e.tokenID))).size;

fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

const summary = {
  generated: new Date().toISOString(),
  highest_block: highestBlock,
  unique_holders: Object.keys(snapshot).length,
  total_cards: totalCards,
  distinct_token_ids: distinctIds,
  rows_enriched: enriched,
  rows_still_unmapped: stillUnmapped,
  rarity_totals: rarityTotals,
};
fs.writeFileSync(path.join(__dirname, 'm1-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
