/**
 * Fetch ALL sales (Xeet MP + OpenSea) for Senti__23 cards, all rarities.
 *
 * 1. Load OpenSea API key from .env
 * 2. Fetch all NFTs from OpenSea → filter by Handle trait → get token IDs
 * 3. For each token ID: fetch Xeet sales + OpenSea sale events
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
const OS_BASE = 'https://api.opensea.io';

// Load .env
function loadEnv() {
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

const osHeaders = { 'X-API-KEY': OS_API_KEY, Accept: 'application/json' };

// --- OpenSea: fetch all NFTs ---

async function fetchAllNFTs() {
  const allNFTs = [];
  let cursor = undefined;

  for (let page = 0; ; page++) {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('next', cursor);
    const res = await fetch(`${OS_BASE}/api/v2/collection/${COLLECTION_SLUG}/nfts?${params}`, { headers: osHeaders });
    if (!res.ok) { console.error(`OpenSea NFT error: ${res.status}`); break; }
    const data = await res.json();
    if (!data.nfts?.length) break;
    allNFTs.push(...data.nfts);
    console.log(`  Fetched ${allNFTs.length} NFTs from OpenSea...`);
    if (!data.next) break;
    cursor = data.next;
  }

  // Also try contract endpoint for any missing
  cursor = undefined;
  const existingIds = new Set(allNFTs.map(n => n.identifier));
  for (let page = 0; ; page++) {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('next', cursor);
    const res = await fetch(`${OS_BASE}/api/v2/chain/${CHAIN}/contract/${CONTRACT}/nfts?${params}`, { headers: osHeaders });
    if (!res.ok) break;
    const data = await res.json();
    if (!data.nfts?.length) break;
    for (const nft of data.nfts) {
      if (!existingIds.has(nft.identifier)) { allNFTs.push(nft); existingIds.add(nft.identifier); }
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

// --- OpenSea: fetch sale events for specific token IDs ---

async function fetchOpenSeaSales(tokenIds) {
  // Fetch ALL sale events for the collection, then filter by our token IDs
  const targetIds = new Set(tokenIds.map(String));
  const sales = [];
  let cursor = undefined;

  console.log('  Fetching OpenSea sale events for collection...');
  for (let page = 0; ; page++) {
    const params = new URLSearchParams({ event_type: 'sale', limit: '200' });
    if (cursor) params.set('next', cursor);
    const res = await fetch(`${OS_BASE}/api/v2/events/collection/${COLLECTION_SLUG}?${params}`, { headers: osHeaders });
    if (!res.ok) { console.error(`  OpenSea events error: ${res.status}`); break; }
    const data = await res.json();
    if (!data.asset_events?.length) break;

    for (const evt of data.asset_events) {
      if (targetIds.has(String(evt.nft?.identifier))) {
        sales.push(evt);
      }
    }

    console.log(`  Scanned ${(page + 1) * 200} OpenSea events, found ${sales.length} matching sales...`);
    if (!data.next) break;
    cursor = data.next;
  }

  return sales;
}

// --- Xeet: fetch per-card sales ---

async function fetchXeetSales(tokenId) {
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const url = `${XEET_BASE}/api/marketplace/discovery/activity?tokenType=CARD&tokenId=${tokenId}&limit=100&offset=${offset}&eventType=SALE`;
    try {
      const res = await fetch(url);
      if (!res.ok) break;
      const json = await res.json();
      const events = Array.isArray(json?.data) ? json.data : json?.data?.events ?? json?.events ?? (Array.isArray(json) ? json : []);
      if (events.length === 0) break;
      all.push(...events);
      if (events.length < 100) break;
    } catch { break; }
  }
  return all;
}

// --- Formatting helpers ---

function formatEth(weiStr, decimals = 18) {
  return (Number(BigInt(weiStr)) / Math.pow(10, decimals)).toFixed(6);
}

function printSalesTable(label, sales) {
  if (sales.length === 0) {
    console.log(`  No ${label} sales found.\n`);
    return;
  }
  console.log(`  ${label}: ${sales.length} sale(s)`);
  for (const s of sales) {
    console.log(`  ${s.date} | ${s.price.padStart(12)} | ${s.seller.padEnd(18)} | ${s.buyer}`);
  }
  console.log('');
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

  const byRarity = {};
  for (const t of tokens) { (byRarity[t.rarity] ??= []).push(t); }

  console.log(`\nFound ${tokens.length} ${HANDLE} card(s):`);
  for (const [rarity, cards] of Object.entries(byRarity)) {
    console.log(`  ${rarity.toUpperCase()}: ${cards.length} token(s) — IDs: ${cards.map(c => c.tokenId).join(', ')}`);
  }

  // Step 2: Fetch OpenSea sales for all our token IDs at once
  console.log(`\n\nStep 2: Fetching OpenSea sale events...\n`);
  const allTokenIds = tokens.map(t => t.tokenId);
  const osSaleEvents = await fetchOpenSeaSales(allTokenIds);

  // Index OS sales by tokenId
  const osSalesByToken = {};
  for (const evt of osSaleEvents) {
    const tid = String(evt.nft?.identifier);
    (osSalesByToken[tid] ??= []).push({
      date: new Date(evt.event_timestamp).toISOString().slice(0, 19).replace('T', ' '),
      price: `${formatEth(evt.payment?.quantity ?? '0', evt.payment?.decimals ?? 18)} ${evt.payment?.symbol ?? 'ETH'}`,
      priceRaw: Number(BigInt(evt.payment?.quantity ?? '0')) / Math.pow(10, evt.payment?.decimals ?? 18),
      seller: evt.seller ? `${evt.seller.slice(0, 6)}...${evt.seller.slice(-4)}` : '?',
      buyer: evt.buyer ? `${evt.buyer.slice(0, 6)}...${evt.buyer.slice(-4)}` : '?',
      source: 'opensea',
    });
  }

  // Step 3: Fetch Xeet sales per token
  console.log(`\nStep 3: Fetching Xeet marketplace sales...\n`);
  console.log('='.repeat(85));

  for (const [rarity, cards] of Object.entries(byRarity)) {
    console.log(`\n  *** ${rarity.toUpperCase()} ***\n`);

    for (const card of cards) {
      console.log(`  --- Token #${card.tokenId} — ${card.name} ---`);
      console.log('  DATE                 | PRICE        | SELLER             | BUYER');
      console.log('  ' + '-'.repeat(80));

      // Xeet sales
      const xeetSales = await fetchXeetSales(card.tokenId);
      const xeetFormatted = xeetSales.map(s => ({
        date: new Date(s.timestamp).toISOString().slice(0, 19).replace('T', ' '),
        price: `${s.priceXeets ?? s.price ?? '?'} XEETS`,
        priceRaw: s.priceXeets ?? s.price ?? 0,
        seller: s.sellerHandle || s.seller?.handle || '?',
        buyer: s.buyerHandle || s.buyer?.handle || '?',
        source: 'xeet',
        ts: new Date(s.timestamp).getTime(),
      }));

      // OpenSea sales
      const osFormatted = (osSalesByToken[card.tokenId] || []).map(s => ({
        ...s,
        ts: new Date(s.date).getTime(),
      }));

      // Merge and sort by date descending
      const allSales = [...xeetFormatted, ...osFormatted].sort((a, b) => b.ts - a.ts);

      if (allSales.length === 0) {
        console.log('  No sales found on either marketplace.\n');
        continue;
      }

      for (const s of allSales) {
        const tag = s.source === 'opensea' ? '[OS]' : '[XM]';
        console.log(`  ${s.date} | ${(s.price + ' ' + tag).padStart(16)} | ${s.seller.padEnd(18)} | ${s.buyer}`);
      }

      // Stats
      const xeetPrices = xeetFormatted.map(s => s.priceRaw).filter(p => p > 0);
      const osPrices = osFormatted.map(s => s.priceRaw).filter(p => p > 0);

      console.log('');
      if (xeetPrices.length > 0) {
        const vol = xeetPrices.reduce((a, b) => a + b, 0);
        console.log(`  Xeet MP:   ${xeetPrices.length} sales | Vol: ${vol} XEETS | Avg: ${(vol / xeetPrices.length).toFixed(1)} | Range: ${Math.min(...xeetPrices)}-${Math.max(...xeetPrices)}`);
      }
      if (osPrices.length > 0) {
        const vol = osPrices.reduce((a, b) => a + b, 0);
        console.log(`  OpenSea:   ${osPrices.length} sales | Vol: ${vol.toFixed(6)} ETH | Avg: ${(vol / osPrices.length).toFixed(6)} | Range: ${Math.min(...osPrices).toFixed(6)}-${Math.max(...osPrices).toFixed(6)}`);
      }
      if (xeetPrices.length === 0 && osPrices.length === 0) {
        console.log('  No sales recorded.');
      }
      console.log('');
    }
  }

  console.log('='.repeat(85));
  console.log('  [XM] = Xeet Marketplace    [OS] = OpenSea');
  console.log('='.repeat(85) + '\n');
}

main().catch(console.error);
