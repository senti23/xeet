// refresh-token-map.mjs — fill in metadata for token IDs missing from xeet.db.token_map
// Read-only against the DB; outputs to JSON only. No production writes.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const KEY = env.OPENSEA_API_KEY;
const CONTRACT = env.MEGAETH_CONTRACT || '0xce8cb6676f6cfb3161a72a723b436987c6cf4e68';
const CHAIN_PARAM = env.MEGAETH_OS_CHAIN_PARAM || 'megaeth';
if (!KEY) { console.error('OPENSEA_API_KEY missing'); process.exit(1); }

console.log('refresh-token-map.mjs — filling missing creator/rarity entries for MegaETH token_ids');
console.log('');

// Step 1 — Compute missing-ID list ────────────────────────────────────────────
const events = JSON.parse(fs.readFileSync(path.join(__dirname, 'megaeth-raw-events.json'), 'utf8'));
const megaIds = new Set();
for (const e of events) megaIds.add(String(e.tokenID));

const mapRows = JSON.parse(execSync(
  `sqlite3 -json "${path.join(REPO_ROOT, 'xeet.db')}" "SELECT token_id, creator_handle, rarity FROM token_map"`
).toString());
const knownIds = new Set(mapRows.map(r => String(r.token_id)));

const missingIds = [...megaIds].filter(id => !knownIds.has(id));
missingIds.sort((a, b) => (+a) - (+b));
console.log(`MegaETH distinct token_ids: ${megaIds.size}`);
console.log(`Already in xeet.db token_map: ${[...megaIds].filter(id => knownIds.has(id)).length}`);
console.log(`Missing (to fetch from OpenSea): ${missingIds.length}`);
console.log('');

// Step 2 — Fetch metadata per missing ID ───────────────────────────────────────
const additions = [];
const errors = [];
const epicMythic = [];
const allowedRarities = new Set(['common', 'rare', 'legendary']);
const startTime = Date.now();

// Simple sequential pacing — 0.5s between calls = 2 req/s, matching the existing AdaptiveRateLimiter default
const SLEEP_MS = 500;
const MAX_RETRIES = 3;

async function fetchNft(tokenId) {
  const url = `https://api.opensea.io/api/v2/chain/${CHAIN_PARAM}/contract/${CONTRACT}/nfts/${tokenId}`;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'X-API-KEY': KEY } });
      if (r.status === 429 || r.status >= 500) {
        if (attempt < MAX_RETRIES) {
          await new Promise(res => setTimeout(res, 1500 * 2 ** (attempt - 1)));
          continue;
        }
        return { error: `HTTP ${r.status}` };
      }
      if (!r.ok) return { error: `HTTP ${r.status}` };
      return { json: await r.json() };
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        await new Promise(res => setTimeout(res, 1500 * 2 ** (attempt - 1)));
        continue;
      }
      return { error: e.message };
    }
  }
  return { error: 'unreachable' };
}

function findTrait(traits, name) {
  if (!Array.isArray(traits)) return null;
  return traits.find(t => (t.trait_type || '').toLowerCase() === name.toLowerCase())?.value ?? null;
}

console.log(`Fetching metadata for ${missingIds.length} tokens (~${Math.round(missingIds.length * SLEEP_MS / 1000)}s estimated)...`);
let done = 0;
for (const tokenId of missingIds) {
  const { json, error } = await fetchNft(tokenId);
  done++;
  if (error) {
    errors.push({ token_id: tokenId, error });
    if (done % 25 === 0 || done === missingIds.length) console.log(`  ${done}/${missingIds.length}  (err on #${tokenId}: ${error})`);
    await new Promise(r => setTimeout(r, SLEEP_MS));
    continue;
  }
  const nft = json.nft || json;
  const handle = findTrait(nft.traits, 'Handle');
  const rarity = findTrait(nft.traits, 'Rarity');
  const name = nft.name || null;
  const image_url = nft.image_url || nft.display_image_url || null;
  const norm = {
    token_id: tokenId,
    creator_handle: handle ? String(handle).toLowerCase() : null,
    rarity: rarity ? String(rarity).toLowerCase() : null,
    name,
    image_url,
  };
  // Validate rarity
  if (norm.rarity && !allowedRarities.has(norm.rarity)) {
    epicMythic.push({ ...norm, raw_rarity: rarity });
    if (done % 25 === 0 || done === missingIds.length) console.log(`  ${done}/${missingIds.length}  (#${tokenId} = ${norm.creator_handle} ${rarity} — EPIC/MYTHIC, skipping)`);
  } else if (!norm.creator_handle || !norm.rarity) {
    errors.push({ token_id: tokenId, error: 'incomplete-traits', norm });
    if (done % 25 === 0 || done === missingIds.length) console.log(`  ${done}/${missingIds.length}  (#${tokenId} = INCOMPLETE traits)`);
  } else {
    additions.push(norm);
    if (done % 25 === 0 || done === missingIds.length) console.log(`  ${done}/${missingIds.length}  (#${tokenId} = ${norm.creator_handle} ${norm.rarity})`);
  }
  await new Promise(r => setTimeout(r, SLEEP_MS));
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log('');
console.log(`Done in ${elapsed}s`);
console.log(`  additions: ${additions.length}`);
console.log(`  errors:    ${errors.length}`);
console.log(`  epic/mythic: ${epicMythic.length}`);

// Step 4 — Output artifacts ──────────────────────────────────────────────────
fs.writeFileSync(path.join(__dirname, 'token-map-additions.json'), JSON.stringify(additions, null, 2));
fs.writeFileSync(path.join(__dirname, 'epic_mythic_observed.json'), JSON.stringify(epicMythic, null, 2));

// Per-rarity breakdown
const rarityBreakdown = {};
for (const a of additions) rarityBreakdown[a.rarity] = (rarityBreakdown[a.rarity] || 0) + 1;

// Ground truth check
const groundTruth = additions.find(a => a.token_id === '24');
const groundTruthPass = groundTruth && groundTruth.creator_handle === 'bearish_af' && groundTruth.rarity === 'legendary';

const summary = {
  step: 'refresh-token-map',
  ts: new Date().toISOString(),
  elapsed_seconds: +elapsed,
  megaeth_token_ids_total: megaIds.size,
  already_mapped: [...megaIds].filter(id => knownIds.has(id)).length,
  missing_total: missingIds.length,
  additions_written: additions.length,
  errors_count: errors.length,
  epic_mythic_count: epicMythic.length,
  rarity_breakdown: rarityBreakdown,
  ground_truth_24: groundTruth || null,
  ground_truth_passes: !!groundTruthPass,
  errors_sample: errors.slice(0, 10),
};
fs.writeFileSync(path.join(__dirname, 'refresh-token-map-summary.json'), JSON.stringify(summary, null, 2));

console.log('');
console.log('Per-rarity breakdown of additions:');
for (const [r, n] of Object.entries(rarityBreakdown).sort((a,b) => b[1] - a[1])) {
  console.log(`  ${r.padEnd(10)} ${n}`);
}
console.log('');
console.log(`Ground truth check (#24 → bearish_af legendary): ${groundTruthPass ? '✅ PASS' : '❌ FAIL'}`);
if (groundTruth) console.log(`  got: ${groundTruth.creator_handle} / ${groundTruth.rarity} (${groundTruth.name})`);
console.log('');
console.log('Outputs:');
console.log('  analysis/megaeth-verify/token-map-additions.json');
console.log('  analysis/megaeth-verify/epic_mythic_observed.json');
console.log('  analysis/megaeth-verify/refresh-token-map-summary.json');
