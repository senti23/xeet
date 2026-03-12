/**
 * API Probe & Rate Limit Test
 * Tests all APIs for response shapes and probes rate tolerance.
 * Run: npx tsx tests/api-probe.test.ts
 */

const OPENSEA_KEY = 'ddcaac6b9c624a58be000387dd275a17';
const COLLECTION = 'xeet-creator-cards';

interface ProbeResult {
  endpoint: string;
  status: number;
  latencyMs: number;
  sampleFields: string[];
  itemCount?: number;
  error?: string;
}

async function probe(label: string, url: string, headers: Record<string, string> = {}): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, { headers });
    const latencyMs = Date.now() - start;
    const text = await res.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = text.slice(0, 200); }

    const sampleFields = typeof data === 'object' && data !== null
      ? Array.isArray(data)
        ? [`array[${data.length}]`, ...Object.keys(data[0] || {}).slice(0, 8)]
        : Object.keys(data).slice(0, 10)
      : [];

    const itemCount = Array.isArray(data) ? data.length
      : data?.results ? data.results.length
      : data?.orders ? data.orders.length
      : data?.listings ? data.listings.length
      : data?.asset_events ? data.asset_events.length
      : data?.nfts ? data.nfts.length
      : undefined;

    console.log(`✓ ${label} [${res.status}] ${latencyMs}ms — fields: ${sampleFields.join(', ')} — items: ${itemCount ?? 'N/A'}`);

    if (res.status === 200 && typeof data === 'object') {
      console.log(`  Sample: ${JSON.stringify(data?.results?.[0] || data?.orders?.[0] || data?.listings?.[0] || data?.asset_events?.[0] || data?.nfts?.[0] || (Array.isArray(data) ? data[0] : data), null, 2)?.slice(0, 600)}`);
    }

    return { endpoint: label, status: res.status, latencyMs, sampleFields, itemCount };
  } catch (err) {
    const latencyMs = Date.now() - start;
    console.error(`✗ ${label} — ERROR: ${(err as Error).message}`);
    return { endpoint: label, status: 0, latencyMs, sampleFields: [], error: (err as Error).message };
  }
}

async function burstTest(label: string, url: string, headers: Record<string, string>, count: number): Promise<void> {
  console.log(`\n--- Burst test: ${label} (${count} requests) ---`);
  const start = Date.now();
  const results = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      fetch(url, { headers }).then(r => ({ status: r.status, i })).catch(e => ({ status: 0, i, error: (e as Error).message }))
    )
  );
  const elapsed = Date.now() - start;
  const statuses = results.map(r => r.status);
  const success = statuses.filter(s => s === 200).length;
  const rateErrors = statuses.filter(s => s === 429).length;
  console.log(`  ${success}/${count} OK, ${rateErrors} rate-limited, ${elapsed}ms total, effective: ${(count / (elapsed / 1000)).toFixed(1)} req/s`);
}

async function main() {
  console.log('=== Xeet Market Intel — API Probe ===\n');

  // --- Xeet Marketplace ---
  console.log('--- XEET MARKETPLACE ---');
  await probe('Xeet listings', 'https://xeet.ai/api/marketplace/discovery/items?status=ACTIVE&sortBy=price_asc&limit=10');
  await probe('Xeet activity', 'https://xeet.ai/api/marketplace/discovery/activity?limit=10');

  // --- MVC Web ---
  console.log('\n--- MVC-WEB TRACKER ---');
  await probe('MVC creators page 1', 'https://xeet.mvc-web.xyz/api/creators?page=1&limit=5');
  await probe('MVC cards common', 'https://xeet.mvc-web.xyz/api/cards?rarity=common');

  // --- OpenSea REST ---
  const osHeaders = { 'X-API-KEY': OPENSEA_KEY };
  console.log('\n--- OPENSEA REST ---');
  await probe('OS listings', `https://api.opensea.io/api/v2/listings/collection/${COLLECTION}/all?limit=5`, osHeaders);
  await probe('OS sale events', `https://api.opensea.io/api/v2/events/collection/${COLLECTION}?event_type=sale&limit=5`, osHeaders);
  await probe('OS collection stats', `https://api.opensea.io/api/v2/collections/${COLLECTION}/stats`, osHeaders);
  await probe('OS NFTs', `https://api.opensea.io/api/v2/collection/${COLLECTION}/nfts?limit=5`, osHeaders);
  await probe('OS offers', `https://api.opensea.io/api/v2/offers/collection/${COLLECTION}/all?limit=5`, osHeaders);

  // --- Burst tests ---
  console.log('\n=== BURST / RATE LIMIT TESTS ===');
  await burstTest('Xeet listings x5', 'https://xeet.ai/api/marketplace/discovery/items?status=ACTIVE&sortBy=price_asc&limit=5', {}, 5);
  await burstTest('MVC creators x5', 'https://xeet.mvc-web.xyz/api/creators?page=1&limit=5', {}, 5);
  await burstTest('OpenSea listings x5', `https://api.opensea.io/api/v2/listings/collection/${COLLECTION}/all?limit=5`, osHeaders, 5);

  // Wait 2s then do larger burst on OpenSea
  await new Promise(r => setTimeout(r, 2000));
  await burstTest('OpenSea listings x10', `https://api.opensea.io/api/v2/listings/collection/${COLLECTION}/all?limit=5`, osHeaders, 10);

  console.log('\n=== PROBE COMPLETE ===');
}

main().catch(console.error);
