// Test 2 — ABS↔MegaETH wallet pair mapping via bridge event matching
// Reuses megaeth-raw-events.json from Test 1, pulls ABS burns, pairs by tokens+qty+time

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Load .env
const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const KEY = env.ETHERSCAN_API_KEY;
const ABS_CHAIN = '2741';
const ABS_CONTRACT = env.ABSTRACT_CONTRACT || '0xeC27D2237432D06981e1F18581494661517E1bD3';
const ABS_BRIDGE = env.ABS_BRIDGE_CONTRACT;
const MEGA_RELAYER = env.MEGAETH_BRIDGE_RELAYER;

console.log('Test 2 — ABS↔MegaETH wallet pair mapping');
console.log(`  ABS XCC contract:      ${ABS_CONTRACT}`);
console.log(`  ABS bridge contract:   ${ABS_BRIDGE}`);
console.log(`  MegaETH relayer:       ${MEGA_RELAYER}`);
console.log('');

const ZERO = '0x' + '0'.repeat(40);

// ── Step 1: Find ABS bridge first-tx block to scope our scan
console.log('Step 1: Find ABS bridge contract\'s first-tx block...');
const firstTxUrl = `https://api.etherscan.io/v2/api?chainid=${ABS_CHAIN}&module=account&action=txlist&address=${ABS_BRIDGE}&startblock=0&endblock=99999999&page=1&offset=1&sort=asc&apikey=${KEY}`;
const firstTxRes = await fetch(firstTxUrl).then(r => r.json());
const firstTx = firstTxRes.result?.[0];
const ABS_START_BLOCK = firstTx ? parseInt(firstTx.blockNumber, 10) : 0;
console.log(`  ABS bridge first tx: block ${ABS_START_BLOCK} (ts=${firstTx?.timeStamp})`);

// ── Step 2: Pull all ABS XCC token1155tx events from cutoff to now
console.log('\nStep 2: Pull all ABS XCC TransferSingle/Batch events from migration window...');
const absEvents = [];
let absCursor = ABS_START_BLOCK;
let absPage = 0;
const PAGE_SIZE = 10000;
const MAX_PAGES = 50;

while (absPage < MAX_PAGES) {
  const url = `https://api.etherscan.io/v2/api?chainid=${ABS_CHAIN}&module=account&action=token1155tx&contractaddress=${ABS_CONTRACT}&startblock=${absCursor}&endblock=99999999&page=1&offset=${PAGE_SIZE}&sort=asc&apikey=${KEY}`;
  process.stdout.write(`  Page ${absPage + 1} (startblock=${absCursor})... `);
  const res = await fetch(url).then(r => r.json());
  if (res.status !== '1' && res.message !== 'OK') {
    if (res.message === 'No transactions found') { console.log('done'); break; }
    console.error('  ABS API error:', res); break;
  }
  const rows = res.result || [];
  console.log(`got ${rows.length} rows`);
  absEvents.push(...rows);
  if (rows.length < PAGE_SIZE) break;
  const nextBlock = parseInt(rows[rows.length - 1].blockNumber, 10) + 1;
  if (nextBlock <= absCursor) { console.error('  Cursor not advancing'); break; }
  absCursor = nextBlock;
  absPage++;
  await new Promise(r => setTimeout(r, 250));
}

console.log(`  Total ABS events fetched: ${absEvents.length}`);

// ── Step 3: Load MegaETH events from Test 1
console.log('\nStep 3: Load MegaETH events from Test 1 output...');
const megaEvents = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'megaeth-raw-events.json'), 'utf8')
);
console.log(`  Loaded ${megaEvents.length} MegaETH events`);

// ── Step 4: Group ABS burns by tx_hash. Each migration is one tx with N tokens burned
console.log('\nStep 4: Group ABS burns by tx hash...');
const absBurns = new Map(); // tx_hash → { user, tokens: [{tokenId, qty}], blockNumber, timestamp }
for (const e of absEvents) {
  if ((e.to || '').toLowerCase() !== ZERO) continue; // burns only
  const tx = e.hash;
  if (!absBurns.has(tx)) {
    absBurns.set(tx, {
      user: (e.from || '').toLowerCase(),
      tokens: [],
      blockNumber: parseInt(e.blockNumber, 10),
      timestamp: parseInt(e.timeStamp, 10),
    });
  }
  absBurns.get(tx).tokens.push({
    tokenId: String(e.tokenID),
    qty: parseInt(e.tokenValue || e.value || '1', 10),
  });
}
console.log(`  ${absBurns.size} ABS burn txs (= migration initiations)`);

// ── Step 5: Group MegaETH mints by tx_hash. Each is one migration completion
console.log('\nStep 5: Group MegaETH mints by tx hash...');
const megaMints = new Map(); // tx_hash → { user, tokens: [], blockNumber, timestamp }
for (const e of megaEvents) {
  if ((e.from || '').toLowerCase() !== ZERO) continue; // mints only
  const tx = e.hash;
  if (!megaMints.has(tx)) {
    megaMints.set(tx, {
      user: (e.to || '').toLowerCase(),
      tokens: [],
      blockNumber: parseInt(e.blockNumber, 10),
      timestamp: parseInt(e.timeStamp, 10),
    });
  }
  megaMints.get(tx).tokens.push({
    tokenId: String(e.tokenID),
    qty: parseInt(e.tokenValue || e.value || '1', 10),
  });
}
console.log(`  ${megaMints.size} MegaETH mint txs (= migration completions)`);

// ── Step 6: Pair ABS burns ↔ MegaETH mints by (token-id-set, qty-set, time-window)
console.log('\nStep 6: Pair burns ↔ mints by token-set + temporal proximity (≤ 5 min)...');

function tokenSig(tokens) {
  // Canonical signature: sorted "tokenId:qty" entries joined
  return tokens.slice()
    .sort((a, b) => (+a.tokenId) - (+b.tokenId))
    .map(t => `${t.tokenId}:${t.qty}`).join(',');
}

// Index MegaETH mints by signature for fast lookup
const mintsBySig = new Map();
for (const [tx, mint] of megaMints) {
  const sig = tokenSig(mint.tokens);
  if (!mintsBySig.has(sig)) mintsBySig.set(sig, []);
  mintsBySig.get(sig).push({ tx, ...mint });
}

const pairs = [];
const unmatchedBurns = [];
const matchedMintTxs = new Set();

for (const [absTx, burn] of absBurns) {
  const sig = tokenSig(burn.tokens);
  const candidates = mintsBySig.get(sig) || [];
  const valid = candidates
    .filter(m => !matchedMintTxs.has(m.tx))
    .filter(m => Math.abs(m.timestamp - burn.timestamp) <= 5 * 60); // 5 min window
  if (valid.length === 0) {
    unmatchedBurns.push({ absTx, user: burn.user, tokens: burn.tokens.length, ts: burn.timestamp });
    continue;
  }
  // Pick the closest in time
  valid.sort((a, b) => Math.abs(a.timestamp - burn.timestamp) - Math.abs(b.timestamp - burn.timestamp));
  const mint = valid[0];
  matchedMintTxs.add(mint.tx);
  pairs.push({
    abs_wallet: burn.user,
    megaeth_wallet: mint.user,
    abs_tx: absTx,
    megaeth_tx: mint.tx,
    abs_block: burn.blockNumber,
    megaeth_block: mint.blockNumber,
    abs_ts: burn.timestamp,
    megaeth_ts: mint.timestamp,
    latency_seconds: mint.timestamp - burn.timestamp,
    cards_migrated: burn.tokens.reduce((s, t) => s + t.qty, 0),
    token_ids: burn.tokens.map(t => t.tokenId),
  });
}

console.log(`  Pairs matched: ${pairs.length}`);
console.log(`  Unmatched burns: ${unmatchedBurns.length}`);
console.log(`  Unmatched mints: ${megaMints.size - matchedMintTxs.size}`);

// ── Step 7: Aggregate to wallet-level pair table (a wallet may have multiple migration txs)
console.log('\nStep 7: Aggregate to (abs_wallet, megaeth_wallet) tuples...');
const walletPairs = new Map(); // key abs|mega → aggregate
for (const p of pairs) {
  const key = `${p.abs_wallet}|${p.megaeth_wallet}`;
  if (!walletPairs.has(key)) {
    walletPairs.set(key, {
      abs_wallet: p.abs_wallet,
      megaeth_wallet: p.megaeth_wallet,
      first_abs_tx: p.abs_tx,
      first_abs_ts: p.abs_ts,
      last_abs_tx: p.abs_tx,
      last_abs_ts: p.abs_ts,
      total_migrations: 0,
      total_cards_migrated: 0,
      same_address: p.abs_wallet === p.megaeth_wallet,
    });
  }
  const w = walletPairs.get(key);
  w.total_migrations++;
  w.total_cards_migrated += p.cards_migrated;
  if (p.abs_ts > w.last_abs_ts) { w.last_abs_ts = p.abs_ts; w.last_abs_tx = p.abs_tx; }
  if (p.abs_ts < w.first_abs_ts) { w.first_abs_ts = p.abs_ts; w.first_abs_tx = p.abs_tx; }
}

const allPairs = [...walletPairs.values()];
const sameAddressPairs = allPairs.filter(p => p.same_address).length;
const diffAddressPairs = allPairs.filter(p => !p.same_address).length;
console.log(`  Distinct wallet pairs: ${allPairs.length}`);
console.log(`  Same address (non-AGW EOA): ${sameAddressPairs}`);
console.log(`  Different address (AGW unwrap): ${diffAddressPairs}`);

// ── Step 8: Validate Senti's known pair
const SENTI_ABS = '0xc065666a1c3a05b81e8e36009332253c73dc769b';
const SENTI_MEGA = '0x853e1e59c056da9c3bbf4e780ac0acbfe88d999a';
const sentiPair = allPairs.find(p => p.abs_wallet === SENTI_ABS && p.megaeth_wallet === SENTI_MEGA);
console.log(`\nSenti's known pair (${SENTI_ABS} → ${SENTI_MEGA}):`);
console.log(`  ${sentiPair ? '✅ FOUND' : '❌ MISSING'}`);
if (sentiPair) {
  console.log(`  migrations: ${sentiPair.total_migrations}, cards: ${sentiPair.total_cards_migrated}`);
}

// ── Step 9: Sample 5 well-known creators from creators-profiles.json + multi-wallet-creators.json
console.log('\nStep 9: Sample 5 creators (3 single, 2 multi-wallet)...');

// Load creator profiles to get creator wallets
const profiles = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'creators-profiles.json'), 'utf8'));
const multiWallet = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'multi-wallet-creators.json'), 'utf8'));

// Get the wallet for each profile (profiles often have a wallet field; fallback to scanning)
function getCreatorWallets(handle) {
  const p = profiles[handle] || profiles[handle.toLowerCase()];
  const wallets = new Set();
  if (p) {
    // Look for wallet-like fields
    for (const k of Object.keys(p)) {
      const v = p[k];
      if (typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v)) wallets.add(v.toLowerCase());
    }
  }
  // Also pull from multi-wallet
  const mw = multiWallet[handle] || multiWallet[handle.toLowerCase()];
  if (mw) {
    if (mw.primaryWallet) wallets.add(mw.primaryWallet.toLowerCase());
    for (const a of (mw.additionalWallets || [])) {
      if (a.address) wallets.add(a.address.toLowerCase());
    }
  }
  return [...wallets];
}

// Sample creators
const sampleCreators = [
  // 3 single-wallet creators (assuming profiles have wallet info)
  'r2d2zen', 'defi_explora', 'ProofOfEly',
  // 2 multi-wallet creators
  'Carlitoswa_y',
  Object.keys(multiWallet).find(k => k !== 'Carlitoswa_y') || 'KierianV',
];

const sampleResults = [];
for (const handle of sampleCreators) {
  const absWallets = getCreatorWallets(handle);
  const matched = absWallets
    .map(abs => {
      const pair = allPairs.find(p => p.abs_wallet === abs);
      return pair ? { abs, megaeth: pair.megaeth_wallet, cards: pair.total_cards_migrated } : { abs, megaeth: null };
    });
  sampleResults.push({ handle, abs_wallets: absWallets, mappings: matched });
  console.log(`  ${handle}: ${absWallets.length} ABS wallet(s)`);
  for (const m of matched) {
    if (m.megaeth) console.log(`    ✅ ${m.abs.slice(0,12)}... → ${m.megaeth.slice(0,12)}... (${m.cards} cards)`);
    else            console.log(`    ⚠  ${m.abs.slice(0,12)}... → no migration found`);
  }
}

// ── Step 10: Save outputs
const outPath = path.join(__dirname, 'wallet-migrations.json');
fs.writeFileSync(outPath, JSON.stringify(allPairs, null, 2));
console.log(`\nWrote ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);

const summary = {
  test: 'Test 2 — ABS↔MegaETH wallet pairing',
  abs_events_pulled: absEvents.length,
  abs_burn_txs: absBurns.size,
  megaeth_mint_txs: megaMints.size,
  pairs_matched: pairs.length,
  unmatched_burns: unmatchedBurns.length,
  unmatched_mints: megaMints.size - matchedMintTxs.size,
  distinct_wallet_pairs: allPairs.length,
  same_address_pairs: sameAddressPairs,
  agw_unwrap_pairs: diffAddressPairs,
  senti_pair_found: !!sentiPair,
  sample_results: sampleResults,
};
fs.writeFileSync(path.join(__dirname, 'test2-summary.json'), JSON.stringify(summary, null, 2));
console.log('\nDone.');
