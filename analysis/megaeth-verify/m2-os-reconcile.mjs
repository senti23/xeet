// M2 — Reconcile fresh MegaETH snapshot against live OpenSea collection stats (±50 gate)
// + per-wallet spot check (OpenSea account NFTs for discovery, balanceOfBatch on mega RPC as authority).
// Writes m2-reconcile-report.json. Read-only against all sources.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const OS_KEY = env.OPENSEA_API_KEY;
const SLUG = env.MEGAETH_OS_SLUG || 'xeet-creator-cards-mega';
const CHAIN = env.MEGAETH_OS_CHAIN_PARAM || 'megaeth';
const CONTRACT = (env.MEGAETH_CONTRACT || '0xce8cb6676f6cfb3161a72a723b436987c6cf4e68').toLowerCase();
const RPC = env.MEGAETH_RPC_URL || 'https://mainnet.megaeth.com/rpc';
if (!OS_KEY) { console.error('OPENSEA_API_KEY missing'); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function osGet(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'X-API-KEY': OS_KEY, accept: 'application/json' } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    throw new Error(`OS ${res.status} on ${url}`);
  }
  throw new Error(`OS retries exhausted on ${url}`);
}

// balanceOfBatch(address[],uint256[]) selector 0x4e1273f4
function encodeBalanceOfBatch(wallet, ids) {
  const pad = (hex) => hex.padStart(64, '0');
  const n = ids.length;
  const head = '4e1273f4' + pad('40') + pad((0x40 + 32 * (1 + n)).toString(16));
  const addrs = pad(n.toString(16)) + ids.map(() => pad(wallet.slice(2))).join('');
  const idArr = pad(n.toString(16)) + ids.map(i => pad(BigInt(i).toString(16))).join('');
  return '0x' + head + addrs + idArr;
}

async function balanceOfBatch(wallet, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: CONTRACT, data: encodeBalanceOfBatch(wallet, chunk) }, 'latest'] }),
    });
    const json = await res.json();
    if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
    const hex = json.result.slice(2);
    // skip offset word + length word, then n quantity words
    for (let k = 0; k < chunk.length; k++) {
      out.set(String(chunk[k]), parseInt(hex.slice(64 * (2 + k), 64 * (3 + k)), 16));
    }
    await sleep(100);
  }
  return out;
}

async function osAccountTokenIds(wallet) {
  const ids = new Set();
  let next = null;
  do {
    const url = `https://api.opensea.io/api/v2/chain/${CHAIN}/account/${wallet}/nfts?collection=${SLUG}&limit=200${next ? `&next=${encodeURIComponent(next)}` : ''}`;
    const json = await osGet(url);
    for (const nft of json.nfts || []) ids.add(String(nft.identifier));
    next = json.next || null;
    await sleep(500);
  } while (next);
  return ids;
}

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'holders-snapshot.json'), 'utf8'));
const m1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'm1-summary.json'), 'utf8'));

// --- Collection-level ---
const coll = await osGet(`https://api.opensea.io/api/v2/collections/${SLUG}`);
await sleep(500);
const stats = await osGet(`https://api.opensea.io/api/v2/collections/${SLUG}/stats`);
await sleep(500);

const osTotalSupply = Number(coll.total_supply);
const osNumOwners = Number(stats?.total?.num_owners ?? NaN);
const cardsDelta = m1.total_cards - osTotalSupply;
const ownersDeltaPct = Number.isFinite(osNumOwners) ? ((m1.unique_holders - osNumOwners) / osNumOwners * 100) : null;

console.log(`OpenSea total_supply: ${osTotalSupply}  | snapshot: ${m1.total_cards}  | delta: ${cardsDelta}`);
console.log(`OpenSea num_owners:  ${osNumOwners}  | snapshot: ${m1.unique_holders}  | delta%: ${ownersDeltaPct?.toFixed(2)}`);

// --- Per-wallet spot checks: Senti + top holder + a mid-size holder ---
const byTotal = Object.entries(snapshot)
  .map(([w, hs]) => [w, hs.reduce((s, h) => s + h.qty, 0)])
  .sort((a, b) => b[1] - a[1]);
const SENTI = '0x853e1e59c056da9c3bbf4e780ac0acbfe88d999a';
const top = byTotal.find(([w]) => w !== SENTI)[0];
const mid = byTotal[Math.floor(byTotal.length / 2)][0];

const spotChecks = [];
for (const wallet of [SENTI, top, mid]) {
  const snapHoldings = new Map((snapshot[wallet] || []).map(h => [String(h.token_id), h.qty]));
  const osIds = await osAccountTokenIds(wallet);
  const allIds = [...new Set([...snapHoldings.keys(), ...osIds])];
  const chainQty = await balanceOfBatch(wallet, allIds);

  let qtyMismatches = [];
  let chainTotal = 0;
  for (const id of allIds) {
    const onChain = chainQty.get(id) || 0;
    chainTotal += onChain;
    const inSnap = snapHoldings.get(id) || 0;
    if (onChain !== inSnap) qtyMismatches.push({ token_id: id, snapshot: inSnap, on_chain: onChain });
  }
  const snapTotal = [...snapHoldings.values()].reduce((s, q) => s + q, 0);
  const check = {
    wallet,
    snapshot_total: snapTotal,
    onchain_total: chainTotal,
    os_distinct_ids: osIds.size,
    snapshot_distinct_ids: snapHoldings.size,
    qty_mismatches: qtyMismatches,
    pass: qtyMismatches.length === 0,
  };
  spotChecks.push(check);
  console.log(`spot ${wallet}: snap=${snapTotal} chain=${chainTotal} mismatches=${qtyMismatches.length} ${check.pass ? 'PASS' : 'FAIL'}`);
}

const report = {
  generated: new Date().toISOString(),
  slug: SLUG,
  opensea: { total_supply: osTotalSupply, num_owners: osNumOwners },
  snapshot: { total_cards: m1.total_cards, unique_holders: m1.unique_holders, distinct_token_ids: m1.distinct_token_ids, highest_block: m1.highest_block },
  cards_delta: cardsDelta,
  cards_gate_pass: Math.abs(cardsDelta) <= 50,
  owners_delta_pct: ownersDeltaPct,
  spot_checks: spotChecks,
  overall_pass: Math.abs(cardsDelta) <= 50 && spotChecks.every(c => c.pass),
};
fs.writeFileSync(path.join(__dirname, 'm2-reconcile-report.json'), JSON.stringify(report, null, 2));
console.log(`\nOVERALL: ${report.overall_pass ? 'PASS' : 'FAIL'}`);
