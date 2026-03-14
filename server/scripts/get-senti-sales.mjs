/**
 * Fetch all Xeet marketplace sales for Senti__23 cards (all rarities).
 *
 * Approach:
 *   1. Load OpenSea API key from .env
 *   2. Fetch ALL NFTs from OpenSea (same as server's token-map sync)
 *   3. Filter by "Handle" trait = "senti__23" to get token IDs + rarities
 *   4. For each token ID, fetch Xeet per-card sales history
 *
 * Run from server/: node scripts/get-senti-sales.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HANDLE = 'senti__23';
const COLLECTION_SLUG = 'xeet-creator-cards';
const CONTRACT = '0xeC27D2237432D06981e1F18581494661517E1bD3';
const CHAIN = 'abstract';
const XEET_BASE = 'https://xeet.ai';

// Load .env
function loadEnv() {
  // Walk up to find .env
  let dir = resolve(__dirname);
  for (let i = 0; i < 5; i++) {
    try {
      const content = readFileSync(resolve(dir, '.env'), 'utf-8');
      const vars = {};
      for (const line of content.split('\n')) {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) vars[match[1].trim()] = match[2].trim();
      }
      return vars;
    } catch { /* continue */ }
    dir = resolve(dir, '..');
  }
  return {};
}

const env = loadEnv();
const OS_API_KEY = env.OPENSEA_API_KEY;
if (!OS_API_KEY) {
  console.error('Missing OPENSEA_API_KEY in .env');
  process.exit(1);
}

// --- OpenSea: fetch all NFTs and find token IDs by handle trait ---

async function fetchAllNFTs() {
  const allNFTs = [];

  // Fetch from collection endpoint
  let cursor = undefined;
  for (let page = 0; ; page++) {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('next', cursor);

    const url = `https://api.opensea.io/api/v2/collection/${COLLECTION_SLUG}/nfts?${params}`;
    const res = await fetch(url, { headers: { 'X-API-KEY': OS_API_KEY, Accept: 'application/json' } });
    if (!res.ok) { console.error(`OpenSea error: ${res.status}`); break; }
    const data = await res.json();
    if (!data.nfts?.length) break;
    allNFTs.push(...data.nfts);
    console.log(`  Fetched ${allNFTs.length} NFTs from OpenSea...`);
    if (!data.next) break;
    cursor = data.next;
  }

  // Also try contract endpoint
  cursor = undefined;
  const existingIds = new Set(allNFTs.map(n => n.identifier));
  for (let page = 0; ; page++) {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('next', cursor);

    const url = `https://api.opensea.io/api/v2/chain/${CHAIN}/contract/${CONTRACT}/nfts?${params}`;
    const res = await fetch(url, { headers: { 'X-API-KEY': OS_API_KEY, Accept: 'application/json' } });
    if (!res.ok) break;
    const data = await res.json();
    if (!data.nfts?.length) break;
    for (const nft of data.nfts) {
      if (!existingIds.has(nft.identifier)) {
        allNFTs.push(nft);
        existingIds.add(nft.identifier);
      }
    }
    if (!data.next) break;
    cursor = data.next;
  }

  return allNFTs;
}

function findTokensByHandle(nfts, handle) {
  const tokens = [];
  for (const nft of nfts) {
    const handleTrait = nft.traits?.find(t => t.trait_type.toLowerCase() === 'handle');
    const rarityTrait = nft.traits?.find(t => t.trait_type.toLowerCase() === 'rarity');
    if (handleTrait && String(handleTrait.value).toLowerCase() === handle.toLowerCase()) {
      tokens.push({
        tokenId: nft.identifier,
        rarity: rarityTrait ? String(rarityTrait.value).toLowerCase() : 'unknown',
        name: nft.name || handle,
      });
    }
  }
  return tokens;
}

// --- Xeet: fetch per-card sales history ---

async function fetchXeetSales(tokenId) {
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const url = `${XEET_BASE}/api/marketplace/discovery/activity?tokenType=CARD&tokenId=${tokenId}&limit=100&offset=${offset}&eventType=SALE`;
    try {
      const res = await fetch(url);
      if (!res.ok) { console.error(`  Xeet API error for token ${tokenId}: ${res.status}`); break; }
      const json = await res.json();
      const events = Array.isArray(json?.data) ? json.data : json?.data?.events ?? json?.events ?? (Array.isArray(json) ? json : []);
      if (events.length === 0) break;
      all.push(...events);
      if (events.length < 100) break;
    } catch (err) {
      console.error(`  Fetch error for token ${tokenId}:`, err.message);
      break;
    }
  }
  return all;
}

// --- Main ---

async function main() {
  console.log(`\nStep 1: Fetching all NFTs from OpenSea to find ${HANDLE} token IDs...\n`);
  const allNFTs = await fetchAllNFTs();
  console.log(`\nTotal NFTs fetched: ${allNFTs.length}`);

  const tokens = findTokensByHandle(allNFTs, HANDLE);
  if (tokens.length === 0) {
    console.log(`\nNo NFTs found with Handle trait = "${HANDLE}"`);
    return;
  }

  // Group by rarity
  const byRarity = {};
  for (const t of tokens) {
    (byRarity[t.rarity] ??= []).push(t);
  }

  console.log(`\nFound ${tokens.length} ${HANDLE} card(s):`);
  for (const [rarity, cards] of Object.entries(byRarity)) {
    console.log(`  ${rarity.toUpperCase()}: ${cards.length} token(s) — IDs: ${cards.map(c => c.tokenId).join(', ')}`);
  }

  console.log(`\n\nStep 2: Fetching Xeet marketplace sales for each token...\n`);
  console.log('='.repeat(80));

  let grandTotalVolume = 0;
  let grandTotalSales = 0;

  for (const [rarity, cards] of Object.entries(byRarity)) {
    console.log(`\n  *** ${rarity.toUpperCase()} (${cards.length} token${cards.length > 1 ? 's' : ''}) ***\n`);

    let rarityVolume = 0;
    let raritySales = 0;

    for (const card of cards) {
      const sales = await fetchXeetSales(card.tokenId);

      if (sales.length === 0) continue;

      raritySales += sales.length;
      sales.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      console.log(`  Token #${card.tokenId} — ${card.name} — ${sales.length} sale(s)`);
      console.log('  DATE                 | PRICE   | SELLER             | BUYER');
      console.log('  ' + '-'.repeat(76));

      for (const s of sales) {
        const date = new Date(s.timestamp).toISOString().slice(0, 19).replace('T', ' ');
        const price = String(s.priceXeets ?? s.price ?? '?').padStart(7);
        const seller = (s.sellerHandle || s.seller?.handle || '?').padEnd(18);
        const buyer = s.buyerHandle || s.buyer?.handle || '?';
        console.log(`  ${date} | ${price} | ${seller} | ${buyer}`);
      }

      const prices = sales.map(s => s.priceXeets ?? s.price ?? 0).filter(p => p > 0);
      if (prices.length > 0) {
        const vol = prices.reduce((a, b) => a + b, 0);
        rarityVolume += vol;
        const avg = vol / prices.length;
        console.log(`  Min: ${Math.min(...prices)} | Max: ${Math.max(...prices)} | Avg: ${avg.toFixed(1)} | Volume: ${vol} XEETS\n`);
      }
    }

    if (raritySales === 0) {
      console.log(`  No Xeet marketplace sales found for ${rarity} cards.`);
    } else {
      console.log(`  --- ${rarity.toUpperCase()} TOTAL: ${raritySales} sales, ${rarityVolume} XEETS ---`);
    }

    grandTotalVolume += rarityVolume;
    grandTotalSales += raritySales;
  }

  console.log('\n' + '='.repeat(80));
  console.log(`GRAND TOTAL: ${grandTotalSales} sales across all rarities — ${grandTotalVolume} XEETS volume`);
  console.log('='.repeat(80) + '\n');
}

main().catch(console.error);
