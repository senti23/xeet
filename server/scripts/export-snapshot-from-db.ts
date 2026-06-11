/**
 * Export card_holders into the static JSON inputs the scoring pipelines read:
 *   - holder-snapshot.json   { wallet: [{ creator, rarity, token_id, quantity }] }
 *   - creator-holdings.json  { handle: { wallet, holds: [{ creator, rarity, quantity }] } }
 *
 * Mirrors the live rebuild in src/services/deck-refresh.ts (steps 2–3) so that
 * compute-deck-scores.ts and the analysis/phase*.py pipeline see identical shapes.
 * Files are written to the data dir (repo root in dev, DATA_DIR in prod).
 *
 * Usage:
 *   npx tsx scripts/export-snapshot-from-db.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { getDb } from '../src/db/index.js';
import { config } from '../src/config.js';

const DATA_DIR = config.dataDir;

interface HoldingEntry { creator: string; rarity: string; token_id: string; quantity: number }
interface CreatorHolding { wallet: string; holds: Array<{ creator: string; rarity: string; quantity: number }> }

const db = getDb();
const rows = db.prepare(
  'SELECT wallet_address, token_id, quantity, creator_handle, rarity FROM card_holders',
).all() as Array<{ wallet_address: string; token_id: string; quantity: number; creator_handle: string; rarity: string }>;

if (rows.length === 0) {
  console.error('card_holders is empty — seed it first (scripts/seed-holders-megaeth.ts).');
  process.exit(1);
}

// holder-snapshot.json — same grouping as deck-refresh.ts step 2
const holderSnapshot: Record<string, HoldingEntry[]> = {};
for (const row of rows) {
  const addr = row.wallet_address.toLowerCase();
  if (!holderSnapshot[addr]) holderSnapshot[addr] = [];
  holderSnapshot[addr].push({
    creator: row.creator_handle,
    rarity: row.rarity,
    token_id: row.token_id,
    quantity: row.quantity,
  });
}

// creator-holdings.json — same rebuild as deck-refresh.ts step 3
const creatorsData = JSON.parse(readFileSync(resolve(DATA_DIR, 'xeet-creators-full.json'), 'utf-8')) as Array<{
  xHandle: string;
  walletAddress: string;
}>;
const multiWalletData = JSON.parse(readFileSync(resolve(DATA_DIR, 'multi-wallet-creators.json'), 'utf-8')) as Record<
  string,
  { primaryWallet: string; additionalWallets: Array<{ address: string }> }
>;

const xccWalletToHandle = new Map<string, string>();
for (const c of creatorsData) {
  if (c.walletAddress) xccWalletToHandle.set(c.walletAddress.toLowerCase(), c.xHandle.toLowerCase());
}
for (const [handle, mw] of Object.entries(multiWalletData)) {
  for (const aw of mw.additionalWallets) {
    xccWalletToHandle.set(aw.address.toLowerCase(), handle.toLowerCase());
  }
}

const creatorHoldings: Record<string, CreatorHolding> = {};
for (const [wallet, holdings] of Object.entries(holderSnapshot)) {
  const handle = xccWalletToHandle.get(wallet);
  if (!handle) continue;
  if (!creatorHoldings[handle]) creatorHoldings[handle] = { wallet, holds: [] };
  for (const h of holdings) {
    const existing = creatorHoldings[handle];
    if (!existing.holds.some((e) => e.creator === h.creator && e.rarity === h.rarity)) {
      existing.holds.push({ creator: h.creator, rarity: h.rarity, quantity: h.quantity });
    }
  }
}

const snapPath = resolve(DATA_DIR, 'holder-snapshot.json');
const holdingsPath = resolve(DATA_DIR, 'creator-holdings.json');
writeFileSync(snapPath, JSON.stringify(holderSnapshot, null, 2));
writeFileSync(holdingsPath, JSON.stringify(creatorHoldings, null, 2));

const totalCards = rows.reduce((s, r) => s + r.quantity, 0);
console.log(`holder-snapshot.json:  ${Object.keys(holderSnapshot).length} wallets / ${totalCards} cards → ${snapPath}`);
console.log(`creator-holdings.json: ${Object.keys(creatorHoldings).length} XCC wallets matched → ${holdingsPath}`);
