import { getDb, getStmts } from '../db/index.js';
import { childLogger } from '../lib/logger.js';
import { getXeetOrderExecutedLogs, type OrderExecutedSale } from './abscan-client.js';
import {
  getSaleEvents,
  type OpenSeaSaleEvent,
} from './opensea-client.js';
import {
  getCreatorRarity,
  getAllCreators,
  initTokenMap,
} from './token-map.js';

const log = childLogger('onchain-sales');

// --- Types ---

export interface BackfillResult {
  xeetLogsFetched: number;
  xeetSalesInserted: number;
  osSalesInserted: number;
  totalRows: number;
  highestBlock: number;
}

export interface SyncResult {
  xeetNew: number;
  osNew: number;
  inserted: number;
}

// --- Xeet sale insertion ---

function insertXeetSale(sale: OrderExecutedSale): boolean {
  const stmts = getStmts();
  const mapping = getCreatorRarity(sale.tokenId);
  if (!mapping) return false;

  const soldAt = new Date(sale.timestamp * 1000).toISOString();

  try {
    const result = stmts.upsertSale.run(
      'xeet',
      sale.tokenId,
      mapping.handle.toLowerCase(),
      mapping.rarity,
      sale.xeetPrice,
      'XEETS',
      null, // price_usd
      sale.seller,
      sale.buyer,
      sale.orderHash,
      sale.txHash,
      soldAt,
    );
    return result.changes > 0;
  } catch {
    return false; // dedup constraint
  }
}

// --- OpenSea sale insertion ---

function insertOsSale(evt: OpenSeaSaleEvent): boolean {
  const stmts = getStmts();
  const tokenId = evt.nft?.identifier;
  if (!tokenId) return false;

  const mapping = getCreatorRarity(tokenId);
  if (!mapping) return false;

  const price = Number(evt.payment?.quantity ?? 0) / Math.pow(10, evt.payment?.decimals ?? 18);
  const soldAt = new Date(Number(evt.event_timestamp) * 1000).toISOString();

  try {
    const result = stmts.upsertSale.run(
      'opensea',
      tokenId,
      mapping.handle.toLowerCase(),
      mapping.rarity,
      price,
      evt.payment?.symbol ?? 'ETH',
      null, // price_usd
      evt.seller ?? null,
      evt.buyer ?? null,
      evt.order_hash ?? null,
      evt.transaction ?? null,
      soldAt,
    );
    return result.changes > 0;
  } catch {
    return false; // dedup constraint
  }
}

// --- Backfill ---

let backfillRunning = false;

/**
 * Full backfill from on-chain event logs. Runs once, idempotent via pipeline_meta.
 * Xeet sales: OrderExecuted logs from Abscan (complete history with XEETS price).
 * OS sales: getSaleEvents() from OpenSea API (already paginated).
 */
export async function backfillFromChain(): Promise<BackfillResult | null> {
  if (backfillRunning) {
    log.warn('On-chain backfill already in progress, skipping');
    return null;
  }

  const stmts = getStmts();

  // Check if both Xeet and OS backfills are complete
  const xeetMeta = stmts.getPipelineMeta.get('xeet_onchain_backfill_complete') as { value: string } | undefined;
  const osMeta = stmts.getPipelineMeta.get('os_backfill_complete') as { value: string } | undefined;
  const legacyMeta = stmts.getPipelineMeta.get('onchain_backfill_complete') as { value: string } | undefined;
  const xeetDone = xeetMeta?.value === 'true' || legacyMeta?.value === 'true';
  const osDone = osMeta?.value === 'true';

  if (xeetDone && osDone) {
    log.info('On-chain backfill already completed (both Xeet + OS), skipping');
    return null;
  }

  backfillRunning = true;
  log.info('Starting on-chain sales backfill (event logs v2)');

  try {
    // Ensure token_map is populated
    if (getAllCreators().size === 0) {
      log.info('Token map empty — initializing before backfill');
      await initTokenMap();
    }

    const db = getDb();
    let xeetInserted = 0;
    let xeetUnmapped = 0;
    let xeetLogCount = 0;

    // 1. Xeet OrderExecuted logs (skip if already done from previous run)
    if (xeetDone) {
      log.info('Xeet backfill already complete, skipping Xeet portion');
    } else {
      log.info('Fetching Xeet OrderExecuted logs from Abscan...');
      const xeetLogs = await getXeetOrderExecutedLogs(0);
      xeetLogCount = xeetLogs.length;
      log.info({ count: xeetLogs.length }, 'Xeet OrderExecuted logs fetched (card sales only)');

      // 2. Insert Xeet sales
      const insertXeetBatch = db.transaction((logs: OrderExecutedSale[]) => {
        for (const sale of logs) {
          if (insertXeetSale(sale)) {
            xeetInserted++;
          } else {
            if (!getCreatorRarity(sale.tokenId)) xeetUnmapped++;
          }
        }
      });

      for (let i = 0; i < xeetLogs.length; i += 500) {
        insertXeetBatch(xeetLogs.slice(i, i + 500));
        if (i > 0 && i % 1000 === 0) {
          log.info({ processed: i, inserted: xeetInserted, unmapped: xeetUnmapped }, 'Xeet backfill progress');
        }
      }
      log.info({ total: xeetLogs.length, inserted: xeetInserted, unmapped: xeetUnmapped }, 'Xeet sales backfill complete');

      // Persist Xeet completion + last synced block
      const highestBlock = xeetLogs.length > 0
        ? Math.max(...xeetLogs.map((s) => s.blockNumber))
        : 0;
      stmts.upsertPipelineMeta.run('xeet_onchain_backfill_complete', 'true');
      stmts.upsertPipelineMeta.run('last_xeet_synced_block', String(highestBlock));
    }

    // 3. Fetch all OpenSea sale events (uncapped for backfill — need full history)
    let osInserted = 0;
    let osUnmapped = 0;
    let osEventCount = 0;

    if (osDone) {
      log.info('OS backfill already complete, skipping OS portion');
    } else {
      log.info('Fetching OpenSea sale events for backfill (uncapped pages)...');
      const osEvents = await getSaleEvents({ maxPages: 500 }).catch((e) => {
        log.error({ err: e }, 'OpenSea sale events fetch failed');
        return [] as OpenSeaSaleEvent[];
      });
      osEventCount = osEvents.length;
      log.info({ count: osEvents.length }, 'OpenSea sale events fetched');

      if (osEvents.length < 9000) {
        log.warn(
          { count: osEvents.length, expected: '~9,553' },
          'OpenSea event count lower than expected — mvc-web cross-reference will surface any gap',
        );
      }

      // 4. Insert OS sales
      const insertOsBatch = db.transaction((events: OpenSeaSaleEvent[]) => {
        for (const evt of events) {
          if (insertOsSale(evt)) {
            osInserted++;
          } else {
            const tokenId = evt.nft?.identifier;
            if (tokenId && !getCreatorRarity(tokenId)) osUnmapped++;
          }
        }
      });

      for (let i = 0; i < osEvents.length; i += 500) {
        insertOsBatch(osEvents.slice(i, i + 500));
        if (i > 0 && i % 2000 === 0) {
          log.info({ processed: i, inserted: osInserted, unmapped: osUnmapped }, 'OS backfill progress');
        }
      }
      log.info({ total: osEvents.length, inserted: osInserted, unmapped: osUnmapped }, 'OS sales backfill complete');

      // Persist OS completion
      stmts.upsertPipelineMeta.run('os_backfill_complete', 'true');
    }

    // Mark overall backfill complete (legacy compat)
    stmts.upsertPipelineMeta.run('onchain_backfill_complete', 'true');

    // Count total rows
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM sale_history').get() as { cnt: number };
    const totalRows = countRow.cnt;

    // Read back highest block for result
    const lastBlockMeta = stmts.getPipelineMeta.get('last_xeet_synced_block') as { value: string } | undefined;
    const highestBlock = lastBlockMeta ? parseInt(lastBlockMeta.value, 10) : 0;

    const result: BackfillResult = {
      xeetLogsFetched: xeetLogCount,
      xeetSalesInserted: xeetInserted,
      osSalesInserted: osInserted,
      totalRows,
      highestBlock,
    };

    log.info(result, 'On-chain backfill complete (event logs v2)');
    return result;
  } finally {
    backfillRunning = false;
  }
}

// --- Incremental Xeet sync ---

/**
 * Sync new Xeet sales since last_xeet_synced_block.
 * Called every cycle. OS sales are handled separately in data-pipeline.ts.
 */
export async function syncXeetSales(): Promise<SyncResult> {
  const stmts = getStmts();

  const metaRow = stmts.getPipelineMeta.get('last_xeet_synced_block') as { value: string } | undefined;
  const lastBlock = metaRow ? parseInt(metaRow.value, 10) : 0;

  if (lastBlock === 0) {
    // Backfill hasn't run yet — skip incremental sync
    return { xeetNew: 0, osNew: 0, inserted: 0 };
  }

  const newLogs = await getXeetOrderExecutedLogs(lastBlock + 1);
  if (newLogs.length === 0) {
    return { xeetNew: 0, osNew: 0, inserted: 0 };
  }

  let inserted = 0;
  const db = getDb();
  const insertBatch = db.transaction((logs: OrderExecutedSale[]) => {
    for (const sale of logs) {
      if (insertXeetSale(sale)) inserted++;
    }
  });

  insertBatch(newLogs);

  // Update last_xeet_synced_block
  const highestBlock = Math.max(...newLogs.map((s) => s.blockNumber));
  stmts.upsertPipelineMeta.run('last_xeet_synced_block', String(highestBlock));

  log.info(
    { newLogs: newLogs.length, inserted, lastBlock, newHighestBlock: highestBlock },
    'Xeet incremental sync complete',
  );

  return { xeetNew: newLogs.length, osNew: 0, inserted };
}

// --- Status helpers ---

export function isOnchainBackfillComplete(): boolean {
  const meta = getStmts().getPipelineMeta.get('onchain_backfill_complete') as { value: string } | undefined;
  return meta?.value === 'true';
}
