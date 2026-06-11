// M5 — Token IDs that exist on Abstract but have never appeared on MegaETH.
// Candidates = (token_map ∪ OpenSea ABS collection enumeration) − MegaETH-observed IDs.
// holder_count_on_abs from OpenSea per-NFT owners, VERIFIED via balanceOfBatch on ABS RPC.
// Output: abstract-only-tokens.json. Read-only everywhere. Sequential OpenSea (2 req/s).

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
async function osGet(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'X-API-KEY': OS_KEY, accept: 'application/json' } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
    throw new Error(`OS ${res.status} on ${url}`);
  }
  throw new Error('OS retries exhausted');
}

// paired balanceOfBatch: accounts[i] ↔ ids[i]
function encodePairs(pairs) {
  const pad = (hex) => hex.padStart(64, '0');
  const n = pairs.length;
  return '0x4e1273f4' + pad('40') + pad((0x40 + 32 * (1 + n)).toString(16))
    + pad(n.toString(16)) + pairs.map(p => pad(p.owner.slice(2))).join('')
    + pad(n.toString(16)) + pairs.map(p => pad(BigInt(p.id).toString(16))).join('');
}
async function balanceOfPairs(pairs) {
  const out = [];
  for (let i = 0; i < pairs.length; i += 100) {
    const chunk = pairs.slice(i, i + 100);
    const res = await fetch(ABS_RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: ABS_CONTRACT, data: encodePairs(chunk) }, 'latest'] }),
    });
    const json = await res.json();
    if (json.error) throw new Error(`RPC: ${JSON.stringify(json.error)}`);
    const hex = json.result.slice(2);
    for (let k = 0; k < chunk.length; k++) out.push(parseInt(hex.slice(64 * (2 + k), 64 * (3 + k)), 16));
    await sleep(100);
  }
  return out;
}

// --- ID sets ---
const megaEvents = JSON.parse(fs.readFileSync(path.join(__dirname, 'megaeth-raw-events.json'), 'utf8'));
const megaIds = new Set(megaEvents.map(e => String(e.tokenID)));

const dbRows = JSON.parse(
  execSync(`sqlite3 -json "${path.join(REPO_ROOT, 'xeet.db')}" "SELECT token_id, creator_handle, rarity FROM token_map;"`).toString()
);
const additions = JSON.parse(fs.readFileSync(path.join(__dirname, 'token-map-additions.json'), 'utf8'));
const tokenMap = new Map();
for (const r of dbRows) tokenMap.set(String(r.token_id), { creator: r.creator_handle, rarity: r.rarity });
for (const a of additions) tokenMap.set(String(a.token_id), { creator: a.creator_handle, rarity: a.rarity });

// OpenSea ABS collection enumeration (immune to Etherscan partial-pagination)
const absEnumerated = new Set();
let next = null;
let pages = 0;
do {
  const url = `https://api.opensea.io/api/v2/collection/${ABS_SLUG}/nfts?limit=200${next ? `&next=${encodeURIComponent(next)}` : ''}`;
  const json = await osGet(url);
  for (const nft of json.nfts || []) absEnumerated.add(String(nft.identifier));
  next = json.next || null;
  pages++;
  await sleep(500);
} while (next && pages < 50);
console.log(`ABS collection enumeration: ${absEnumerated.size} token IDs (${pages} pages)`);

const absUniverse = new Set([...tokenMap.keys(), ...absEnumerated]);
const candidates = [...absUniverse].filter(id => !megaIds.has(id)).sort((a, b) => Number(a) - Number(b));
console.log(`ABS universe: ${absUniverse.size} | mega-observed: ${megaIds.size} | abstract-only candidates: ${candidates.length}`);

// Mega holder counts (sanity: should be 0 for candidates)
const megaSnapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'holders-snapshot.json'), 'utf8'));
const megaHolderCount = new Map();
for (const hs of Object.values(megaSnapshot)) {
  for (const h of hs) megaHolderCount.set(String(h.token_id), (megaHolderCount.get(String(h.token_id)) || 0) + 1);
}

// --- Per candidate: metadata + owners from OpenSea per-NFT, verified on-chain ---
const rows = [];
const errors = [];
for (let i = 0; i < candidates.length; i++) {
  const id = candidates[i];
  try {
    const json = await osGet(`https://api.opensea.io/api/v2/chain/abstract/contract/${ABS_CONTRACT}/nfts/${id}`);
    const nft = json.nft || {};
    let meta = tokenMap.get(id);
    if (!meta) {
      const find = (t) => (nft.traits || []).find(x => (x.trait_type || '').toLowerCase() === t)?.value;
      meta = { creator: (find('handle') || null)?.toLowerCase?.() ?? null, rarity: (find('rarity') || null)?.toLowerCase?.() ?? null };
    }
    const osOwners = (nft.owners || []).map(o => ({ owner: o.address.toLowerCase(), id, os_qty: o.quantity }));
    // Verify on-chain
    let verified = [];
    if (osOwners.length > 0) {
      const qtys = await balanceOfPairs(osOwners);
      verified = osOwners.map((o, k) => ({ ...o, chain_qty: qtys[k] })).filter(o => o.chain_qty > 0);
    }
    rows.push({
      token_id: id,
      creator_handle: meta.creator,
      rarity: meta.rarity,
      holder_count_on_abs: verified.length,
      abs_total_qty: verified.reduce((s, o) => s + o.chain_qty, 0),
      holder_count_on_mega: megaHolderCount.get(id) || 0,
      os_owner_count_unverified: osOwners.length,
    });
  } catch (err) {
    errors.push({ token_id: id, error: String(err.message || err) });
  }
  if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${candidates.length}`);
  await sleep(500);
}

const byRarity = {};
for (const r of rows) byRarity[r.rarity || 'unknown'] = (byRarity[r.rarity || 'unknown'] || 0) + 1;

const out = {
  generated: new Date().toISOString(),
  candidate_count: candidates.length,
  rarity_distribution: byRarity,
  prior_session_reference: { count: 47, legendary: 36, rare: 11 },
  errors,
  tokens: rows,
};
fs.writeFileSync(path.join(__dirname, 'abstract-only-tokens.json'), JSON.stringify(out, null, 2));
console.log(`\nWrote abstract-only-tokens.json: ${rows.length} rows, ${errors.length} errors`);
console.log('Rarity distribution:', JSON.stringify(byRarity));
console.log('Tokens with zero verified ABS holders:', rows.filter(r => r.holder_count_on_abs === 0).length);
