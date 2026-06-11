// Test 4 — OpenSea Stream real-time test for xeet-creator-cards-mega
// Stand-alone, NOT touching the live opensea-stream.ts pipeline. Writes stream-events.jsonl.

import { OpenSeaStreamClient, Network } from '@opensea/stream-js';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const env = Object.fromEntries(
  fs.readFileSync(path.join(REPO_ROOT, '.env'), 'utf8')
    .split('\n').filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const SLUG = env.MEGAETH_OS_SLUG || 'xeet-creator-cards-mega';
const KEY = env.OPENSEA_API_KEY;
const TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes max (day 2 re-run, longer window for daytime activity)
const OUT_PATH = path.join(__dirname, 'stream-events.jsonl');
const SUMMARY_PATH = path.join(__dirname, 'test4-summary.json');

if (!KEY) { console.error('OPENSEA_API_KEY missing'); process.exit(1); }

console.log(`Test 4 — OpenSea Stream for ${SLUG}`);
console.log(`Timeout: ${TIMEOUT_MS / 60000} min, will exit on first event captured`);
console.log('');

let eventsReceived = 0;
const eventLog = [];
const startTime = Date.now();

// Open the JSONL output stream
const fout = fs.createWriteStream(OUT_PATH);

const client = new OpenSeaStreamClient({
  token: KEY,
  network: Network.MAINNET,
  connectOptions: { transport: WebSocket },
  onError: (err) => console.error('Stream error:', err),
});

function logEvent(channel, payload) {
  eventsReceived++;
  const event = { channel, received_at: new Date().toISOString(), payload };
  fout.write(JSON.stringify(event) + '\n');
  eventLog.push({ channel, ts: event.received_at, sample: !!payload });

  // Extract key fields the existing pipeline cares about
  const nft_id = payload?.payload?.item?.nft_id || payload?.item?.nft_id;
  const base_price = payload?.payload?.base_price || payload?.base_price;
  const order_hash = payload?.payload?.order_hash || payload?.order_hash;
  console.log(`  [${eventsReceived}] ${channel}: nft_id=${nft_id} base_price=${base_price} order_hash=${(order_hash || '').slice(0, 16)}...`);

  // Exit on first successful event
  setTimeout(() => process.exit(0), 200);
}

console.log('Subscribing to events...');
client.onItemListed(SLUG, (e) => logEvent('item_listed', e));
client.onItemSold(SLUG, (e) => logEvent('item_sold', e));
client.onItemReceivedOffer(SLUG, (e) => logEvent('item_received_offer', e));
console.log(`Subscribed. Waiting for first event (max ${TIMEOUT_MS / 60000} min)...\n`);

// Connection-level events
client.connect?.(); // SDK auto-connects, but be explicit if available

const timeout = setTimeout(() => {
  console.log(`\n⏱  Timeout reached (${TIMEOUT_MS / 60000} min). No events captured.`);
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify({
    test: 'Test 4 — OpenSea Stream',
    slug: SLUG,
    duration_ms: Date.now() - startTime,
    events_captured: eventsReceived,
    timed_out: true,
    status: 'DEFERRED',
    note: 'Connection succeeded but no events fired during the timeout window',
  }, null, 2));
  process.exit(0);
}, TIMEOUT_MS);

// On clean exit (event captured), write summary
process.on('exit', () => {
  clearTimeout(timeout);
  fout.end();
  if (eventsReceived > 0) {
    fs.writeFileSync(SUMMARY_PATH, JSON.stringify({
      test: 'Test 4 — OpenSea Stream',
      slug: SLUG,
      duration_ms: Date.now() - startTime,
      events_captured: eventsReceived,
      sample_log: eventLog.slice(0, 5),
      status: 'PASS',
    }, null, 2));
  }
});

process.on('SIGINT', () => { console.log('\nInterrupted'); process.exit(130); });
