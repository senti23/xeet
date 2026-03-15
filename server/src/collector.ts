/**
 * Standalone sales data collector — runs WITHOUT the Fastify server.
 *
 * Continuously fetches sales from both Xeet and OpenSea marketplaces,
 * persists to SQLite, and keeps the dataset live.
 *
 * Usage:
 *   npx tsx src/collector.ts              # run once + daemon (60s interval)
 *   npx tsx src/collector.ts --once       # run once and exit
 *   npx tsx src/collector.ts --backfill   # full historical backfill + daemon
 *   npx tsx src/collector.ts --interval 30  # custom interval in seconds
 *
 * Can also be built and run via:
 *   npm run build && node dist/collector.js
 *
 * Or via cron (run --once every N minutes):
 *   0/5 * * * * cd /path/to/server && npx tsx src/collector.ts --once
 */

import { config } from './config.js';
import { childLogger } from './lib/logger.js';
import { getDb, getStmts } from './db/index.js';
import { initTokenMap, getAllCreators, getTokenIds, getCreatorRarity, type Rarity } from './services/token-map.js';
import * as xeetClient from './services/xeet-client.js';
import { normalizeTimestamp } from './services/xeet-client.js';
import * as osClient from './services/opensea-client.js';

const log = childLogger('collector');

// --- CLI args ---
const args = process.argv.slice(2);
const runOnce = args.includes('--once');
const doBackfill = args.includes('--backfill');
const intervalIdx = args.indexOf('--interval');
const intervalSec = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1], 10) : 60;
const intervalMs = intervalSec * 1000;

// --- Stats tracking ---
interface CycleStats {
  xeetSalesNew: number;
  osSalesNew: number;
  xeetActivity: number;
  osEvents: number;
  elapsed: number;
}

/**
 * Run a single collection cycle: fetch recent sales from both marketplaces
 * and persist to SQLite.
 */
async function collectCycle(): Promise<CycleStats> {
  const start = Date.now();
  const stmts = getStmts();
  let xeetSalesNew = 0;
  let osSalesNew = 0;

  // Fetch from both sources in parallel
  const [xeetActivity, osSaleEvents] = await Promise.all([
    xeetClient.getActivity().catch((e) => {
      log.error({ err: e }, 'Xeet activity fetch failed');
      return [] as xeetClient.XeetActivityEvent[];
    }),
    osClient.getSaleEvents().catch((e) => {
      log.error({ err: e }, 'OpenSea sale events fetch failed');
      return [] as osClient.OpenSeaSaleEvent[];
    }),
  ]);

  // Persist Xeet sales
  for (const evt of xeetActivity) {
    const eventType = (evt.eventType ?? '').toUpperCase();
    if (eventType !== 'SALE') continue;

    const tokenId = evt.tokenId;
    const price = evt.priceXeets ?? 0;
    const timestamp = normalizeTimestamp(evt.timestamp ?? '');
    if (!tokenId || !price || !timestamp) continue;

    let cr = evt.creatorHandle || evt.creatorId;
    let rarity = (evt.rarity ?? '').toLowerCase();
    if ((!cr || !rarity) && tokenId) {
      const mapping = getCreatorRarity(tokenId);
      if (mapping) { cr = cr || mapping.handle; rarity = rarity || mapping.rarity; }
    }
    if (!cr || !rarity) continue;

    try {
      stmts.upsertSale.run(
        'xeet', tokenId, cr.toLowerCase(), rarity, price, 'XEETS', null,
        evt.sellerHandle ?? null, evt.buyerHandle ?? null,
        null, null, timestamp,
      );
      xeetSalesNew++;
    } catch { /* duplicate */ }
  }

  // Persist OpenSea sales
  for (const evt of osSaleEvents) {
    const tokenId = evt.nft?.identifier;
    if (!tokenId || !evt.event_timestamp) continue;
    const mapping = getCreatorRarity(tokenId);
    if (!mapping) continue;
    const price = Number(evt.payment?.quantity ?? 0) / Math.pow(10, evt.payment?.decimals ?? 18);

    // Convert Unix seconds to ISO string if needed
    let soldAt = evt.event_timestamp;
    const tsNum = Number(soldAt);
    if (!isNaN(tsNum) && tsNum < 1e12) {
      soldAt = new Date(tsNum * 1000).toISOString();
    }

    try {
      stmts.upsertSale.run(
        'opensea', tokenId, mapping.handle.toLowerCase(), mapping.rarity, price,
        evt.payment?.symbol ?? 'ETH', null,
        evt.seller ?? null, evt.buyer ?? null,
        evt.order_hash ?? null, evt.transaction ?? null, soldAt,
      );
      osSalesNew++;
    } catch { /* duplicate */ }
  }

  const elapsed = Date.now() - start;
  log.info({
    xeetSalesNew, osSalesNew,
    xeetActivity: xeetActivity.length,
    osEvents: osSaleEvents.length,
    elapsedMs: elapsed,
  }, 'Collection cycle complete');

  return { xeetSalesNew, osSalesNew, xeetActivity: xeetActivity.length, osEvents: osSaleEvents.length, elapsed };
}

/**
 * Full historical backfill for both marketplaces.
 * Fetches per-card sales for every known token ID.
 */
async function backfill(): Promise<void> {
  const stmts = getStmts();
  const allCreators = getAllCreators();
  const rarities: Rarity[] = ['common', 'rare', 'legendary'];

  // Collect all token IDs
  const tokenIds: Array<{ tokenId: string; handle: string; rarity: Rarity }> = [];
  for (const [, creator] of allCreators) {
    for (const rarity of rarities) {
      const ids = getTokenIds(creator.handle, rarity);
      for (const id of ids) {
        tokenIds.push({ tokenId: id, handle: creator.handle, rarity });
      }
    }
  }

  log.info({ totalTokens: tokenIds.length }, 'Starting full historical backfill');

  // NOTE: We fetch ALL tokens — INSERT OR IGNORE handles dedup.
  // Previous skip logic caused missed historical sales.

  let xeetFetched = 0, xeetNew = 0, xeetSkipped = 0, xeetErrors = 0;
  let osFetched = 0, osNew = 0, osSkipped = 0, osErrors = 0;

  for (const { tokenId, handle, rarity } of tokenIds) {
    // Xeet backfill
    try {
      const sales = await xeetClient.getCardSalesHistory(tokenId);
      xeetFetched++;
      for (const evt of sales) {
        const price = evt.priceXeets ?? 0;
        const timestamp = evt.timestamp ?? '';
        if (!price || !timestamp) continue;
        try {
          stmts.upsertSale.run(
            'xeet', tokenId, handle.toLowerCase(), rarity, price, 'XEETS', null,
            evt.sellerHandle ?? null, evt.buyerHandle ?? null,
            null, null, timestamp,
          );
          xeetNew++;
        } catch { /* duplicate */ }
      }
    } catch {
      xeetErrors++;
    }

    // OpenSea backfill
    try {
      const sales = await osClient.getTokenSaleEvents(tokenId);
      osFetched++;
      for (const evt of sales) {
        if (!evt.event_timestamp) continue;
        const price = Number(evt.payment?.quantity ?? 0) / Math.pow(10, evt.payment?.decimals ?? 18);
        let soldAt = evt.event_timestamp;
        const tsNum = Number(soldAt);
        if (!isNaN(tsNum) && tsNum < 1e12) {
          soldAt = new Date(tsNum * 1000).toISOString();
        }
        try {
          stmts.upsertSale.run(
            'opensea', tokenId, handle.toLowerCase(), rarity, price,
            evt.payment?.symbol ?? 'ETH', null,
            evt.seller ?? null, evt.buyer ?? null,
            evt.order_hash ?? null, evt.transaction ?? null, soldAt,
          );
          osNew++;
        } catch { /* duplicate */ }
      }
    } catch {
      osErrors++;
    }

    // Progress log every 50 tokens
    const total = xeetFetched + xeetErrors;
    if (total % 50 === 0 && total > 0) {
      log.info({
        progress: `${total}/${tokenIds.length}`,
        xeet: { fetched: xeetFetched, new: xeetNew, skipped: xeetSkipped, errors: xeetErrors },
        opensea: { fetched: osFetched, new: osNew, skipped: osSkipped, errors: osErrors },
      }, 'Backfill progress');
    }
  }

  log.info({
    xeet: { fetched: xeetFetched, new: xeetNew, skipped: xeetSkipped, errors: xeetErrors },
    opensea: { fetched: osFetched, new: osNew, skipped: osSkipped, errors: osErrors },
  }, 'Full historical backfill complete');
}

/**
 * Print a summary of the current dataset.
 */
function printSummary(): void {
  const db = getDb();
  const totalSales = (db.prepare('SELECT COUNT(*) as c FROM sale_history').get() as any).c;
  const xeetSales = (db.prepare("SELECT COUNT(*) as c FROM sale_history WHERE marketplace = 'xeet'").get() as any).c;
  const osSales = (db.prepare("SELECT COUNT(*) as c FROM sale_history WHERE marketplace = 'opensea'").get() as any).c;
  const uniqueTokens = (db.prepare('SELECT COUNT(DISTINCT token_id) as c FROM sale_history').get() as any).c;
  const uniqueCreators = (db.prepare('SELECT COUNT(DISTINCT creator_handle) as c FROM sale_history').get() as any).c;
  const earliest = (db.prepare('SELECT MIN(sold_at) as d FROM sale_history').get() as any).d;
  const latest = (db.prepare('SELECT MAX(sold_at) as d FROM sale_history').get() as any).d;

  console.log('\n' + '='.repeat(60));
  console.log('  SALES DATASET SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Total sales:      ${totalSales}`);
  console.log(`    Xeet MP:        ${xeetSales}`);
  console.log(`    OpenSea:        ${osSales}`);
  console.log(`  Unique tokens:    ${uniqueTokens}`);
  console.log(`  Unique creators:  ${uniqueCreators}`);
  console.log(`  Date range:       ${earliest} → ${latest}`);
  console.log('='.repeat(60) + '\n');
}

// --- Main ---

async function main(): Promise<void> {
  log.info({ mode: runOnce ? 'once' : 'daemon', backfill: doBackfill, intervalSec }, 'Collector starting');

  // Initialize DB + token map (required for mapping token IDs → creators)
  getDb();
  log.info('Database ready');

  await initTokenMap();
  log.info('Token map initialized');

  // Full backfill if requested
  if (doBackfill) {
    await backfill();
  }

  // Run first cycle
  await collectCycle();
  printSummary();

  if (runOnce) {
    log.info('Single run complete, exiting');
    process.exit(0);
  }

  // Daemon mode: keep running on interval
  log.info({ intervalSec }, 'Running in daemon mode — collecting every N seconds');

  setInterval(async () => {
    try {
      await collectCycle();
    } catch (err) {
      log.error({ err }, 'Collection cycle error');
    }
  }, intervalMs);

  // Graceful shutdown
  const shutdown = () => {
    log.info('Collector shutting down');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error({ err }, 'Collector fatal error');
  process.exit(1);
});
