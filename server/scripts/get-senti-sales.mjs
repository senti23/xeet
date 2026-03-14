/**
 * Fetch all Xeet marketplace sales for Senti__23 cards (all rarities).
 * Run: node scripts/get-senti-sales.mjs
 */

const XEET_BASE = 'https://xeet.ai';
const HANDLE = 'senti__23';

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Step 1: Find all token IDs for the creator by paginating through ALL listings
async function findTokenIds() {
  const tokens = new Map();
  const PAGE = 250;

  // Search all active listings
  console.log('Scanning all marketplace listings...');
  for (let offset = 0; ; offset += PAGE) {
    const json = await fetchJson(`${XEET_BASE}/api/marketplace/discovery/items?status=ACTIVE&sortBy=price_asc&limit=${PAGE}&offset=${offset}`);
    const items = json?.data?.items ?? json?.items ?? (Array.isArray(json) ? json : []);
    if (items.length === 0) break;

    for (const item of items) {
      const handle = (item.creatorHandle || item.creator?.handle || '').toLowerCase();
      if (handle === HANDLE) {
        tokens.set(item.tokenId, {
          tokenId: item.tokenId,
          rarity: item.rarity,
          name: item.assetName || item.creator?.displayName || 'Senti',
        });
      }
    }
    console.log(`  Scanned ${offset + items.length} listings, found ${tokens.size} Senti cards so far...`);
    if (items.length < PAGE) break;
  }

  // Also search all activity events (catches cards not currently listed)
  console.log('Scanning all activity events...');
  for (let offset = 0; ; offset += PAGE) {
    const json = await fetchJson(`${XEET_BASE}/api/marketplace/discovery/activity?limit=${PAGE}&offset=${offset}`);
    const events = Array.isArray(json?.data) ? json.data : json?.data?.events ?? json?.events ?? (Array.isArray(json) ? json : []);
    if (events.length === 0) break;

    for (const evt of events) {
      const handle = (evt.creatorHandle || evt.creator?.handle || '').toLowerCase();
      if (handle === HANDLE && evt.tokenId && !tokens.has(evt.tokenId)) {
        tokens.set(evt.tokenId, {
          tokenId: evt.tokenId,
          rarity: evt.rarity,
          name: evt.assetName || 'Senti',
        });
      }
    }
    console.log(`  Scanned ${offset + events.length} events, found ${tokens.size} Senti cards so far...`);
    if (events.length < PAGE) break;
  }

  return Array.from(tokens.values());
}

// Step 2: Fetch full sales history for a specific tokenId
async function fetchSales(tokenId) {
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const json = await fetchJson(`${XEET_BASE}/api/marketplace/discovery/activity?tokenType=CARD&tokenId=${tokenId}&limit=100&offset=${offset}&eventType=SALE`);
    const events = Array.isArray(json?.data) ? json.data : json?.data?.events ?? json?.events ?? (Array.isArray(json) ? json : []);
    if (events.length === 0) break;
    all.push(...events);
    if (events.length < 100) break;
  }
  return all;
}

async function main() {
  console.log(`\nFinding all ${HANDLE} card token IDs...\n`);
  const tokens = await findTokenIds();

  if (tokens.length === 0) {
    console.log(`\nNo ${HANDLE} tokens found in listings or activity.`);
    console.log('Your cards may not have been listed/sold on the Xeet marketplace yet.');
    return;
  }

  console.log(`\nFound ${tokens.length} card(s):`);
  for (const t of tokens) {
    console.log(`  Token #${t.tokenId} — ${t.rarity} — ${t.name}`);
  }

  console.log('\n========== FULL SALES HISTORY ==========\n');

  let grandTotal = 0;
  for (const token of tokens) {
    const sales = await fetchSales(token.tokenId);
    console.log(`\n--- ${token.name} (${(token.rarity || '?').toUpperCase()}) — Token #${token.tokenId} ---`);
    console.log(`Sales: ${sales.length}\n`);

    if (sales.length === 0) {
      console.log('  No sales recorded.');
      continue;
    }

    sales.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    console.log('  DATE                 | PRICE   | SELLER             | BUYER');
    console.log('  ' + '-'.repeat(78));
    for (const s of sales) {
      const date = new Date(s.timestamp).toISOString().slice(0, 19).replace('T', ' ');
      const price = String(s.priceXeets ?? s.price ?? '?').padStart(7);
      const seller = (s.sellerHandle || s.seller?.handle || '?').padEnd(18);
      const buyer = s.buyerHandle || s.buyer?.handle || '?';
      console.log(`  ${date} | ${price} | ${seller} | ${buyer}`);
    }

    const prices = sales.map(s => s.priceXeets ?? s.price ?? 0).filter(p => p > 0);
    if (prices.length > 0) {
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      const volume = prices.reduce((a, b) => a + b, 0);
      grandTotal += volume;
      console.log(`\n  Avg: ${avg.toFixed(1)} XEETS | Min: ${Math.min(...prices)} | Max: ${Math.max(...prices)} | Volume: ${volume} XEETS`);
    }
  }

  if (grandTotal > 0) {
    console.log(`\n========================================`);
    console.log(`TOTAL VOLUME ACROSS ALL CARDS: ${grandTotal} XEETS`);
    console.log(`========================================\n`);
  }
}

main().catch(console.error);
