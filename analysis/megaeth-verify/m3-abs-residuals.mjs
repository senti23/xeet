// M3 — LIVE Abstract residual holdings for all creator wallets.
// Authoritative path per SESSION_LEARNINGS §3: OpenSea per-account NFTs (discovery only)
// + balanceOfBatch via Abstract RPC (quantities). NO Etherscan event replay.
// Resumable: progress checkpointed to abs-residuals-progress.jsonl (delete to restart).
// Explicit per-wallet ok/error states — no silent zeros.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
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
const ABS_CONTRACT = '0xec27d2237432d06981e1f18581494661517e1bd3';
const ABS_RPC = 'https://api.mainnet.abs.xyz';
const ABS_SLUG = 'xeet-creator-cards';
if (!OS_KEY) { console.error('OPENSEA_API_KEY missing'); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- Wallet universe: creators-full ∪ multi-wallet ∪ creator-holdings ---
const creatorsFull = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'xeet-creators-full.json'), 'utf8'));
const multiWallet = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'multi-wallet-creators.json'), 'utf8'));
const creatorHoldings = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'creator-holdings.json'), 'utf8'));

const walletToHandles = new Map(); // wallet → Set(handles), for the report
function addWallet(w, handle) {
  if (!w) return;
  const lw = w.toLowerCase();
  if (!walletToHandles.has(lw)) walletToHandles.set(lw, new Set());
  walletToHandles.get(lw).add(handle.toLowerCase());
}
for (const c of creatorsFull) addWallet(c.walletAddress, c.xHandle);
for (const [handle, mw] of Object.entries(multiWallet)) {
  addWallet(mw.primaryWallet, handle);
  for (const aw of mw.additionalWallets || []) addWallet(aw.address, handle);
}
for (const [handle, ch] of Object.entries(creatorHoldings)) addWallet(ch.wallet, handle);

const wallets = [...walletToHandles.keys()];
console.log(`Wallet universe: ${wallets.length} distinct ABS wallets across ${creatorsFull.length} creators`);

// --- Token metadata (token_map ∪ additions) ---
const dbRows = JSON.parse(
  execSync(`sqlite3 -json "${path.join(REPO_ROOT, 'xeet.db')}" "SELECT token_id, creator_handle, rarity FROM token_map;"`).toString()
);
const additions = JSON.parse(fs.readFileSync(path.join(__dirname, 'token-map-additions.json'), 'utf8'));
const tokenMap = new Map();
for (const r of dbRows) tokenMap.set(String(r.token_id), { creator: r.creator_handle, rarity: r.rarity });
for (const a of additions) tokenMap.set(String(a.token_id), { creator: a.creator_handle, rarity: a.rarity });

// --- Resume support ---
const progressPath = path.join(__dirname, 'abs-residuals-progress.jsonl');
const done = new Map();
if (fs.existsSync(progressPath)) {
  for (const line of fs.readFileSync(progressPath, 'utf8').split('\n').filter(Boolean)) {
    const rec = JSON.parse(line);
    if (rec.ok) done.set(rec.wallet, rec); // errored wallets get retried on resume
  }
  console.log(`Resuming: ${done.size} wallets already checked`);
}

async function osGet(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'X-API-KEY': OS_KEY, accept: 'application/json' } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
    throw new Error(`OS ${res.status}`);
  }
  throw new Error('OS retries exhausted');
}

function encodeBalanceOfBatch(wallet, ids) {
  const pad = (hex) => hex.padStart(64, '0');
  const n = ids.length;
  return '0x4e1273f4' + pad('40') + pad((0x40 + 32 * (1 + n)).toString(16))
    + pad(n.toString(16)) + ids.map(() => pad(wallet.slice(2))).join('')
    + pad(n.toString(16)) + ids.map(i => pad(BigInt(i).toString(16))).join('');
}

async function balanceOfBatch(wallet, ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const res = await fetch(ABS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: ABS_CONTRACT, data: encodeBalanceOfBatch(wallet, chunk) }, 'latest'] }),
    });
    const json = await res.json();
    if (json.error) throw new Error(`RPC: ${JSON.stringify(json.error)}`);
    const hex = json.result.slice(2);
    for (let k = 0; k < chunk.length; k++) {
      out.set(String(chunk[k]), parseInt(hex.slice(64 * (2 + k), 64 * (3 + k)), 16));
    }
    await sleep(100);
  }
  return out;
}

let processed = 0;
const startedAt = Date.now();
for (const wallet of wallets) {
  if (done.has(wallet)) continue;
  let rec;
  try {
    // Discovery: distinct token IDs currently indexed for this wallet on ABS
    const ids = new Set();
    let next = null;
    do {
      const url = `https://api.opensea.io/api/v2/chain/abstract/account/${wallet}/nfts?collection=${ABS_SLUG}&limit=200${next ? `&next=${encodeURIComponent(next)}` : ''}`;
      const json = await osGet(url);
      for (const nft of json.nfts || []) ids.add(String(nft.identifier));
      next = json.next || null;
      await sleep(500);
    } while (next);

    // Authority: on-chain quantities
    let holdings = [];
    if (ids.size > 0) {
      const qty = await balanceOfBatch(wallet, [...ids]);
      for (const [id, q] of qty) {
        if (q > 0) {
          const meta = tokenMap.get(id) || { creator: null, rarity: null };
          holdings.push({ token_id: id, creator: meta.creator, rarity: meta.rarity, qty: q });
        }
      }
    }
    rec = { wallet, ok: true, holdings };
  } catch (err) {
    rec = { wallet, ok: false, error: String(err.message || err) };
  }
  fs.appendFileSync(progressPath, JSON.stringify(rec) + '\n');
  done.set(wallet, rec);
  processed++;
  if (processed % 25 === 0) {
    const rate = processed / ((Date.now() - startedAt) / 1000);
    console.log(`  ${done.size}/${wallets.length} (${rate.toFixed(1)} wallets/s)`);
  }
}

// --- Final output ---
const out = { generated: new Date().toISOString(), wallets: {}, errors: [] };
let walletsWithCards = 0, totalResidualCards = 0;
for (const [wallet, rec] of done) {
  if (!rec.ok) { out.errors.push({ wallet, error: rec.error, handles: [...(walletToHandles.get(wallet) || [])] }); continue; }
  if (rec.holdings.length > 0) {
    out.wallets[wallet] = { handles: [...(walletToHandles.get(wallet) || [])], holdings: rec.holdings };
    walletsWithCards++;
    totalResidualCards += rec.holdings.reduce((s, h) => s + h.qty, 0);
  }
}
out.summary = {
  wallets_checked: done.size,
  wallets_with_residual_cards: walletsWithCards,
  total_residual_cards: totalResidualCards,
  error_count: out.errors.length,
};
fs.writeFileSync(path.join(__dirname, 'abs-residual-holdings.json'), JSON.stringify(out, null, 2));
console.log('\nSummary:', JSON.stringify(out.summary, null, 2));
if (out.errors.length > 0) console.log(`ERRORS on ${out.errors.length} wallets — rerun to retry (resumable), or inspect abs-residual-holdings.json`);
