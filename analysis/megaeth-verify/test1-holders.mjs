// Test 1 — MegaETH holder discovery via Etherscan v2 token1155tx pagination
// Read-only verification script. No production wiring. Writes holders-snapshot.json.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Load .env minimally
const envPath = path.join(REPO_ROOT, '.env');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const KEY = env.ETHERSCAN_API_KEY;
const CONTRACT = env.MEGAETH_CONTRACT || '0xce8cb6676f6cfb3161a72a723b436987c6cf4e68';
const CHAIN_ID = env.MEGAETH_CHAIN_ID || '4326';
// Initially set to 14761074 (Senti's R2D2 mint), but discovered 2097 earlier events exist.
// Earliest event was block 14734322 (~2026-04-30 06:42 UTC) — others migrated before Senti.
// Resetting to 0 to capture full history.
const START_BLOCK = 0;
const PAGE_SIZE = 10000;
const MAX_PAGES = 50; // safety cap

if (!KEY) {
  console.error('ETHERSCAN_API_KEY missing from .env');
  process.exit(1);
}

console.log(`Test 1 — Holder discovery on MegaETH (chainid=${CHAIN_ID})`);
console.log(`Contract: ${CONTRACT}`);
console.log(`Start block: ${START_BLOCK}`);
console.log('');

// Paginate token1155tx
const allEvents = [];
let cursorBlock = START_BLOCK;
let page = 0;
let lastBlockSeen = 0;

while (page < MAX_PAGES) {
  const url = `https://api.etherscan.io/v2/api?chainid=${CHAIN_ID}&module=account&action=token1155tx&contractaddress=${CONTRACT}&startblock=${cursorBlock}&endblock=99999999&page=1&offset=${PAGE_SIZE}&sort=asc&apikey=${KEY}`;
  process.stdout.write(`  Page ${page + 1} (startblock=${cursorBlock})... `);
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== '1' && json.message !== 'OK') {
    if (json.message === 'No transactions found') {
      console.log('no more results');
      break;
    }
    console.error('API error:', json);
    process.exit(1);
  }
  const rows = json.result || [];
  console.log(`got ${rows.length} rows`);
  allEvents.push(...rows);

  if (rows.length < PAGE_SIZE) break;

  // Advance cursor: next start = last block + 1 (avoid duplicating the last block's events)
  // BUT: if many events share the same block, we'd loop forever. Use lastBlock+1 only.
  const nextBlock = parseInt(rows[rows.length - 1].blockNumber, 10) + 1;
  if (nextBlock <= cursorBlock) {
    console.error('  Cursor not advancing — likely > 10K events at single block; bailing');
    break;
  }
  cursorBlock = nextBlock;
  lastBlockSeen = nextBlock;
  page++;

  // Gentle pacing for free tier (5 req/s)
  await new Promise(r => setTimeout(r, 250));
}

console.log(`\nTotal raw events: ${allEvents.length}`);

// Replay events into balances
// NOTE: Etherscan token1155tx synthesizes one row per token in a transfer (TransferSingle = 1 row,
// TransferBatch = N rows where N = number of token IDs). Each row has from, to, tokenID, tokenValue.
const balances = new Map(); // key: wallet|tokenId → qty

const ZERO = '0x' + '0'.repeat(40);

function add(wallet, tokenId, delta) {
  const key = `${wallet}|${tokenId}`;
  balances.set(key, (balances.get(key) || 0) + delta);
}

let mints = 0, burns = 0, transfers = 0;
for (const e of allEvents) {
  const from = (e.from || '').toLowerCase();
  const to = (e.to || '').toLowerCase();
  const tid = String(e.tokenID);
  const val = parseInt(e.tokenValue || e.value || '1', 10);

  if (from === ZERO && to !== ZERO) {
    add(to, tid, val);
    mints++;
  } else if (from !== ZERO && to === ZERO) {
    add(from, tid, -val);
    burns++;
  } else if (from !== ZERO && to !== ZERO) {
    add(from, tid, -val);
    add(to, tid, val);
    transfers++;
  }
}

console.log(`Mints: ${mints}, Burns: ${burns}, Transfers (peer-to-peer): ${transfers}`);

// Aggregate by wallet
const byWallet = new Map();
let totalQty = 0;
for (const [key, qty] of balances) {
  if (qty <= 0) continue;
  const [wallet, tokenId] = key.split('|');
  if (!byWallet.has(wallet)) byWallet.set(wallet, []);
  byWallet.get(wallet).push({ token_id: tokenId, qty });
  totalQty += qty;
}

console.log(`\nUnique holders (qty > 0): ${byWallet.size}`);
console.log(`Total cards held: ${totalQty}`);

// Enrich with creator/rarity from token_map (xeet.db)
const dbPath = path.join(REPO_ROOT, 'xeet.db');
const tokenMapJson = execSync(
  `sqlite3 -json "${dbPath}" "SELECT token_id, creator_handle, rarity FROM token_map;"`
).toString();
const tokenMapRows = JSON.parse(tokenMapJson);
const tokenMap = new Map(
  tokenMapRows.map(r => [String(r.token_id), { creator: r.creator_handle, rarity: r.rarity }])
);
console.log(`Token map entries available: ${tokenMap.size}`);

// Apply enrichment
let unmappedTokens = 0;
const out = {};
const rarityTotals = { common: 0, rare: 0, legendary: 0, unknown: 0 };
for (const [wallet, holdings] of byWallet) {
  out[wallet] = holdings.map(h => {
    const meta = tokenMap.get(h.token_id);
    if (!meta) {
      unmappedTokens++;
      rarityTotals.unknown += h.qty;
      return { token_id: h.token_id, creator: null, rarity: null, qty: h.qty };
    }
    rarityTotals[meta.rarity] = (rarityTotals[meta.rarity] || 0) + h.qty;
    return { token_id: h.token_id, creator: meta.creator, rarity: meta.rarity, qty: h.qty };
  });
}

console.log(`Unmapped token rows: ${unmappedTokens}`);
console.log('Rarity totals:', rarityTotals);

// Verify Senti's known holdings as ground truth
const SENTI = '0x853e1e59c056da9c3bbf4e780ac0acbfe88d999a';
if (out[SENTI]) {
  const senti = out[SENTI];
  const sentiTotal = senti.reduce((s, h) => s + h.qty, 0);
  console.log(`\nSenti's MegaETH holdings: ${senti.length} entries, ${sentiTotal} cards (expected: ~160)`);
}

// Persist
const outPath = path.join(__dirname, 'holders-snapshot.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`\nWrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);

// Persist raw events too — Test 2 reuses these
const rawOutPath = path.join(__dirname, 'megaeth-raw-events.json');
fs.writeFileSync(rawOutPath, JSON.stringify(allEvents, null, 2));
console.log(`Wrote ${rawOutPath} (${(fs.statSync(rawOutPath).size / 1024 / 1024).toFixed(1)} MB)`);

// Summary line for the report
const summary = {
  test: 'Test 1 — MegaETH holder discovery',
  total_events_pulled: allEvents.length,
  mints: mints,
  burns: burns,
  peer_transfers: transfers,
  unique_holders: byWallet.size,
  total_cards_held: totalQty,
  rarity_totals: rarityTotals,
  unmapped_token_rows: unmappedTokens,
  expected_total_cards: 20041,
  delta_vs_expected: totalQty - 20041,
};
fs.writeFileSync(path.join(__dirname, 'test1-summary.json'), JSON.stringify(summary, null, 2));
console.log('\nDone.');
