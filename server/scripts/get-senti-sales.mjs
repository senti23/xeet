/**
 * Quick script to fetch all Xeet marketplace sales for senti__23 cards.
 * Run: node scripts/get-senti-sales.mjs
 */

const XEET_BASE = 'https://xeet.ai';

async function fetchCardSales(tokenId) {
  const all = [];
  for (let offset = 0; ; offset += 100) {
    const url = `${XEET_BASE}/api/marketplace/discovery/activity?tokenType=CARD&tokenId=${tokenId}&limit=100&offset=${offset}&eventType=SALE`;
    const res = await fetch(url);
    if (!res.ok) { console.error(`Failed for tokenId ${tokenId}: ${res.status}`); break; }
    const json = await res.json();
    const events = json.data ?? json.events ?? (Array.isArray(json) ? json : []);
    if (events.length === 0) break;
    all.push(...events);
    if (events.length < 100) break;
  }
  return all;
}

async function findSentiTokenIds() {
  const res = await fetch(`${XEET_BASE}/api/marketplace/discovery/items?status=ACTIVE&sortBy=price_asc&limit=250&offset=0`);
  const json = await res.json();
  const items = json?.data?.items ?? json?.items ?? (Array.isArray(json) ? json : []);

  const sentiTokens = new Map();
  for (const item of items) {
    const handle = (item.creatorHandle || item.creator?.handle || '').toLowerCase();
    if (handle === 'senti__23') {
      sentiTokens.set(item.tokenId, {
        tokenId: item.tokenId,
        rarity: item.rarity,
        name: item.assetName || item.creator?.displayName || 'Senti',
      });
    }
  }

  const actRes = await fetch(`${XEET_BASE}/api/marketplace/discovery/activity?limit=250&offset=0`);
  const actJson = await actRes.json();
  const events = actJson?.data ?? (Array.isArray(actJson) ? actJson : []);
  for (const evt of events) {
    const handle = (evt.creatorHandle || evt.creator?.handle || '').toLowerCase();
    if (handle === 'senti__23' && evt.tokenId && !sentiTokens.has(evt.tokenId)) {
      sentiTokens.set(evt.tokenId, {
        tokenId: evt.tokenId,
        rarity: evt.rarity,
        name: evt.assetName || 'Senti',
      });
    }
  }

  return Array.from(sentiTokens.values());
}

async function main() {
  console.log('Finding Senti__23 card token IDs...\n');
  const tokens = await findSentiTokenIds();

  if (tokens.length === 0) {
    console.log('No Senti__23 tokens found in current listings/activity.');
    console.log('If you know the token IDs, add them manually below.');
    return;
  }

  console.log(`Found ${tokens.length} Senti__23 card(s):`);
  for (const t of tokens) {
    console.log(`  Token ${t.tokenId} — ${t.rarity} — ${t.name}`);
  }

  console.log('\n--- FULL SALES HISTORY ---\n');

  for (const token of tokens) {
    const sales = await fetchCardSales(token.tokenId);
    console.log(`\n=== ${token.name} (${token.rarity.toUpperCase()}) — Token #${token.tokenId} ===`);
    console.log(`Total sales: ${sales.length}\n`);

    if (sales.length === 0) {
      console.log('  No sales recorded.');
      continue;
    }

    sales.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    console.log('  DATE                 | PRICE | SELLER           | BUYER');
    console.log('  ' + '-'.repeat(75));
    for (const s of sales) {
      const date = new Date(s.timestamp).toISOString().slice(0, 19).replace('T', ' ');
      const price = String(s.priceXeets).padStart(5);
      const seller = (s.sellerHandle || '?').padEnd(16);
      const buyer = s.buyerHandle || '?';
      console.log(`  ${date} | ${price} | ${seller} | ${buyer}`);
    }

    const prices = sales.map(s => s.priceXeets);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    console.log(`\n  Stats: avg=${avg.toFixed(1)} min=${min} max=${max} total_volume=${prices.reduce((a, b) => a + b, 0)}`);
  }
}

main().catch(console.error);
