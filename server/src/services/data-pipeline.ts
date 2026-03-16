import { config } from '../config.js';
import { childLogger } from '../lib/logger.js';
import { getDb, getStmts } from '../db/index.js';
import * as xeetClient from './xeet-client.js';
import { normalizeTimestamp } from './xeet-client.js';
import * as osClient from './opensea-client.js';
import { getCreatorRarity, getAllCreators, getTokenIds, type Rarity } from './token-map.js';
import { fetchEthUsdRate, ethToUsd, getEthUsdRate } from './price-service.js';
import { backfillHolders, refreshHolders } from './holder-service.js';

const log = childLogger('data-pipeline');

export interface CreatorRarityData {
  creator: string;
  displayName: string;
  rarity: Rarity;
  xeetFloor: number | null;
  xeetListingCount: number;
  osFloor: number | null;
  osListingCount: number;
  bestOffer: number | null;
  lastSaleXeet: number | null;
  lastSaleXeetDate: string | null;
  lastSaleOs: number | null;
  lastSaleOsDate: string | null;
  usdEstimate: number | null;
  osFloorExpiry: string | null;
}

export interface PipelineCache {
  data: Map<string, CreatorRarityData>;
  lastUpdated: Date | null;
  ethUsdRate: number;
}

const cache: PipelineCache = {
  data: new Map(),
  lastUpdated: null,
  ethUsdRate: 0,
};

// Previous Xeet listings snapshot for diff (keyed by orderHash)
let previousXeetListings = new Map<string, xeetClient.XeetListing>();

// Callbacks for alert engine
type ListingCallback = (listing: xeetClient.XeetListing, isNew: boolean, isPriceDrop: boolean) => void;
let xeetListingCallback: ListingCallback | null = null;

export function onXeetListingChange(cb: ListingCallback): void {
  xeetListingCallback = cb;
}

export function getCache(): PipelineCache {
  return cache;
}

export function getCacheArray(): CreatorRarityData[] {
  return Array.from(cache.data.values());
}

function key(creator: string, rarity: string): string {
  return `${creator.toLowerCase()}:${rarity}`;
}

async function runCycle(): Promise<void> {
  const start = Date.now();
  log.info('Pipeline cycle starting');

  try {
    // Fetch all data sources in parallel
    const [xeetListings, xeetActivity, osListings, osOffers, osSaleEvents] = await Promise.all([
      xeetClient.getActiveListings().catch((e) => {
        log.error({ err: e }, 'Xeet listings fetch failed');
        return [] as xeetClient.XeetListing[];
      }),
      xeetClient.getActivity().catch((e) => {
        log.error({ err: e }, 'Xeet activity fetch failed');
        return [] as xeetClient.XeetActivityEvent[];
      }),
      osClient.getAllListings().catch((e) => {
        log.error({ err: e }, 'OpenSea listings fetch failed');
        return [] as osClient.OpenSeaOrder[];
      }),
      osClient.getAllOffers().catch((e) => {
        log.error({ err: e }, 'OpenSea offers fetch failed');
        return [] as osClient.OpenSeaOrder[];
      }),
      (async () => {
        // Fetch only events newer than our latest persisted sale
        const latestRow = getStmts().getLatestSaleTimestamp.get('opensea') as { latest: string | null } | undefined;
        const after = latestRow?.latest ?? undefined;
        return osClient.getSaleEvents({ after }).catch((e) => {
          log.error({ err: e }, 'OpenSea sale events fetch failed');
          return [] as osClient.OpenSeaSaleEvent[];
        });
      })(),
    ]);

    // Refresh ETH/USD rate
    await fetchEthUsdRate().catch(() => {});
    cache.ethUsdRate = getEthUsdRate();

    // --- Aggregate Xeet data ---
    // Group by creator+rarity
    const xeetByKey = new Map<string, xeetClient.XeetListing[]>();
    for (const listing of xeetListings) {
      const cr = listing.creatorHandle || listing.creatorId;
      if (!cr || !listing.rarity) continue;
      const k = key(cr, listing.rarity.toLowerCase());
      const arr = xeetByKey.get(k) ?? [];
      arr.push(listing);
      xeetByKey.set(k, arr);
    }

    // --- Persist Xeet sales to SQLite (accumulates over time) ---
    const stmts = getStmts();
    let xeetSalesNew = 0;
    let xeetSalesSkipped = 0;
    for (const evt of xeetActivity) {
      // Only count SALE — LISTING_FILLED is a duplicate of the same event
      const eventType = (evt.eventType ?? '').toUpperCase();
      if (eventType !== 'SALE') continue;

      const tokenId = evt.tokenId;
      const price = evt.priceXeets ?? 0;
      const timestamp = normalizeTimestamp(evt.timestamp ?? '');
      if (!tokenId || !price || !timestamp) { xeetSalesSkipped++; continue; }

      // Resolve creator+rarity — prefer token_map (canonical) over API fields
      // to avoid handle inconsistencies (e.g. API returns "Scotty_NFT" but
      // token_map has "scotty", fragmenting sales across different handles)
      const mapping = tokenId ? getCreatorRarity(tokenId) : null;
      let cr = mapping?.handle || evt.creatorHandle || evt.creatorId;
      let rarity = mapping?.rarity || (evt.rarity ?? '').toLowerCase();
      if (!cr || !rarity) { xeetSalesSkipped++; continue; }

      try {
        stmts.upsertSale.run(
          'xeet', tokenId, cr.toLowerCase(), rarity, price, 'XEETS', null,
          evt.sellerHandle ?? null, evt.buyerHandle ?? null,
          null, null, timestamp,
        );
        xeetSalesNew++;
      } catch {
        // Duplicate — already stored
      }
    }
    log.info({ newSales: xeetSalesNew, skipped: xeetSalesSkipped }, 'Xeet sales persisted');

    // --- Aggregate OpenSea data ---
    // Group listings by creator+rarity via token map
    const osByKey = new Map<string, Array<{ order: osClient.OpenSeaOrder; ethPrice: number }>>();
    let listingsNoToken = 0;
    let listingsUnmapped = 0;
    let listingsMapped = 0;
    const unmappedSampleIds: string[] = [];
    for (const order of osListings) {
      const tokenId = osClient.extractTokenId(order);
      if (!tokenId) { listingsNoToken++; continue; }
      const mapping = getCreatorRarity(tokenId);
      if (!mapping) {
        listingsUnmapped++;
        if (unmappedSampleIds.length < 5) unmappedSampleIds.push(tokenId);
        continue;
      }
      listingsMapped++;
      const k = key(mapping.handle, mapping.rarity);
      const arr = osByKey.get(k) ?? [];
      arr.push({ order, ethPrice: osClient.extractEthPrice(order) });
      osByKey.set(k, arr);
    }

    if (listingsUnmapped > 0) {
      log.warn({
        total: osListings.length,
        mapped: listingsMapped,
        unmapped: listingsUnmapped,
        noTokenId: listingsNoToken,
        sampleUnmappedIds: unmappedSampleIds,
      }, 'OS listings token mapping stats (unmapped tokens have no entry in token_map)');
    }

    // Group offers by creator+rarity via token map
    // Also track collection-wide offers (criteria-based) that apply to ALL tokens
    const offersByKey = new Map<string, number>();
    let offersMapped = 0;
    let offersUnmapped = 0;
    let offersCollection = 0;
    let bestCollectionOffer = 0;
    for (const offer of osOffers) {
      const ethPrice = osClient.extractEthPrice(offer);

      // Check if this is a collection-wide offer (itemType 4/5)
      if (osClient.isCollectionOffer(offer)) {
        offersCollection++;
        if (ethPrice > bestCollectionOffer) {
          bestCollectionOffer = ethPrice;
        }
        continue;
      }

      const tokenId = osClient.extractTokenId(offer);
      if (!tokenId) continue;
      const mapping = getCreatorRarity(tokenId);
      if (!mapping) { offersUnmapped++; continue; }
      offersMapped++;
      const k = key(mapping.handle, mapping.rarity);
      const existing = offersByKey.get(k) ?? 0;
      if (ethPrice > existing) {
        offersByKey.set(k, ethPrice);
      }
    }

    log.info({
      total: osOffers.length,
      mapped: offersMapped,
      unmapped: offersUnmapped,
      collectionOffers: offersCollection,
      bestCollectionOffer,
    }, 'OS offers mapping stats');

    // --- Persist OpenSea sales to SQLite ---
    let osSalesNew = 0;
    for (const evt of osSaleEvents) {
      const tokenId = evt.nft?.identifier;
      if (!tokenId || !evt.event_timestamp) continue;
      const mapping = getCreatorRarity(tokenId);
      if (!mapping) continue;
      const price = Number(evt.payment?.quantity ?? 0) / Math.pow(10, evt.payment?.decimals ?? 18);

      // Normalize timestamp: convert Unix seconds to ISO if needed (must match backfill format)
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
      } catch {
        // Duplicate
      }
    }
    log.info({ newSales: osSalesNew, totalEvents: osSaleEvents.length }, 'OS sales persisted');

    // --- Build cache entries for all creators × rarities ---
    // Read last sales from SQLite (persistent across restarts)
    const allCreators = getAllCreators();
    const newData = new Map<string, CreatorRarityData>();

    for (const [, creator] of allCreators) {
      const rarities: Rarity[] = ['common', 'rare', 'legendary'];
      for (const rarity of rarities) {
        const k = key(creator.handle, rarity);

        // Xeet data
        const xeetArr = xeetByKey.get(k) ?? [];
        const xeetFloor = xeetArr.length > 0
          ? Math.min(...xeetArr.map((l) => l.xeetPrice))
          : null;

        // OpenSea data
        const osArr = osByKey.get(k) ?? [];
        const osFloor = osArr.length > 0
          ? Math.min(...osArr.map((l) => l.ethPrice))
          : null;

        // Find the floor listing's expiry
        let osFloorExpiry: string | null = null;
        if (osArr.length > 0 && osFloor !== null) {
          const floorOrder = osArr.find((l) => l.ethPrice === osFloor);
          if (floorOrder) {
            const expiry = osClient.extractOrderExpiry(floorOrder.order);
            osFloorExpiry = expiry?.toISOString() ?? null;
          }
        }

        // Best offer: max of token-specific offer and collection-wide offer
        const tokenOffer = offersByKey.get(k) ?? 0;
        const bestOffer = Math.max(tokenOffer, bestCollectionOffer) || null;

        // Last sales — read from SQLite (persistent)
        const xeetSaleRow = stmts.getLastSaleByCreatorRarity.get(
          creator.handle.toLowerCase(), rarity, 'xeet',
        ) as { price: number; sold_at: string } | undefined;
        const osSaleRow = stmts.getLastSaleByCreatorRarity.get(
          creator.handle.toLowerCase(), rarity, 'opensea',
        ) as { price: number; sold_at: string } | undefined;

        // USD estimate (ETH-based only)
        const usdEstimate = osFloor !== null ? ethToUsd(osFloor) : null;

        newData.set(k, {
          creator: creator.handle,
          displayName: creator.displayName,
          rarity,
          xeetFloor,
          xeetListingCount: xeetArr.length,
          osFloor,
          osListingCount: osArr.length,
          bestOffer,
          lastSaleXeet: xeetSaleRow?.price ?? null,
          lastSaleXeetDate: xeetSaleRow?.sold_at ?? null,
          lastSaleOs: osSaleRow?.price ?? null,
          lastSaleOsDate: osSaleRow?.sold_at ?? null,
          usdEstimate,
          osFloorExpiry,
        });
      }
    }

    // --- Xeet listing snapshot diff for alerts ---
    if (xeetListingCallback) {
      const currentXeetMap = new Map<string, xeetClient.XeetListing>();
      const prevFloorByKey = new Map<string, number>();
      const currFloorByKey = new Map<string, number>();

      // Build previous floors
      for (const [, listing] of previousXeetListings) {
        const cr = listing.creatorHandle || listing.creatorId;
        if (!cr || !listing.rarity) continue;
        const k = key(cr, listing.rarity.toLowerCase());
        const existing = prevFloorByKey.get(k);
        if (existing === undefined || listing.xeetPrice < existing) {
          prevFloorByKey.set(k, listing.xeetPrice);
        }
      }

      for (const listing of xeetListings) {
        const hash = listing.orderHash || listing.id;
        currentXeetMap.set(hash, listing);

        const cr = listing.creatorHandle || listing.creatorId;
        if (!cr || !listing.rarity) continue;
        const k = key(cr, listing.rarity.toLowerCase());
        const existing = currFloorByKey.get(k);
        if (existing === undefined || listing.xeetPrice < existing) {
          currFloorByKey.set(k, listing.xeetPrice);
        }

        const isNew = !previousXeetListings.has(hash);
        const prevFloor = prevFloorByKey.get(k);
        const isPriceDrop = !isNew && prevFloor !== undefined && listing.xeetPrice < prevFloor;

        if (isNew || isPriceDrop) {
          xeetListingCallback(listing, isNew, isPriceDrop);
        }
      }

      previousXeetListings = currentXeetMap;
    }

    cache.data = newData;
    cache.lastUpdated = new Date();

    const elapsed = Date.now() - start;
    log.info(
      {
        entries: newData.size,
        xeetListings: xeetListings.length,
        xeetActivity: xeetActivity.length,
        xeetSalesNew,
        osListings: osListings.length,
        osOffers: osOffers.length,
        osSalesNew,
        elapsedMs: elapsed,
      },
      'Pipeline cycle complete',
    );
  } catch (err) {
    log.error({ err }, 'Pipeline cycle failed');
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export async function startPipeline(): Promise<void> {
  log.info({ intervalMs: config.pipeline.intervalMs }, 'Starting data pipeline');

  // Run first cycle in background, then kick off backfills after it completes
  runCycle()
    .then(() => {
      // Kick off holder backfill FIRST (fast — single Abscan call)
      if (config.abscan.apiKey) {
        backfillHolders()
          .then((r) => log.info({ transfers: r.transfers, uniqueHolders: r.uniqueHolders, uniqueTokens: r.uniqueTokens, highestBlock: r.highestBlock }, 'Holder backfill complete'))
          .catch((err) => log.error({ err }, 'Holder backfill error'));
      }

      // Kick off sales history backfills sequentially to avoid rate-limit pressure
      backfillXeetSalesHistory()
        .then(() => backfillOpenSeaSalesHistory())
        .catch((err) => log.error({ err }, 'Sales backfill error'));
    })
    .catch((err) => log.error({ err }, 'First pipeline cycle error'));

  // Schedule subsequent cycles (including periodic holder refresh)
  let lastHolderRefresh = Date.now();
  intervalId = setInterval(() => {
    runCycle().catch((err) => log.error({ err }, 'Pipeline interval error'));

    // Holder refresh on a slower cadence
    const now = Date.now();
    if (config.abscan.apiKey && now - lastHolderRefresh > config.pipeline.holderRefreshMs) {
      lastHolderRefresh = now;
      refreshHolders()
        .then((r) => log.info({ transfers: r.transfers, uniqueHolders: r.uniqueHolders, uniqueTokens: r.uniqueTokens, highestBlock: r.highestBlock }, 'Holder refresh complete'))
        .catch((err) => log.error({ err }, 'Holder refresh error'));
    }
  }, config.pipeline.intervalMs);
}

export function stopPipeline(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    log.info('Pipeline stopped');
  }
}

/**
 * Backfill status tracking — per-creator results for both marketplaces.
 */
interface BackfillCreatorResult {
  handle: string;
  rarity: Rarity;
  tokensFetched: number;
  salesFound: number;
  errors: number;
}

interface BackfillStatus {
  running: boolean;
  complete: boolean;
  creatorsProcessed: number;
  creatorsWithSales: number;
  creatorsWithZeroSales: number;
  totalErrors: number;
  totalSalesFound: number;
  results: BackfillCreatorResult[];
}

const xeetBackfillStatus: BackfillStatus = {
  running: false, complete: false,
  creatorsProcessed: 0, creatorsWithSales: 0, creatorsWithZeroSales: 0,
  totalErrors: 0, totalSalesFound: 0, results: [],
};
const osBackfillStatus: BackfillStatus = {
  running: false, complete: false,
  creatorsProcessed: 0, creatorsWithSales: 0, creatorsWithZeroSales: 0,
  totalErrors: 0, totalSalesFound: 0, results: [],
};

export function getBackfillStatus(): { xeet: BackfillStatus; opensea: BackfillStatus } {
  return { xeet: xeetBackfillStatus, opensea: osBackfillStatus };
}

/**
 * Backfill full Xeet sales history for all known token IDs.
 * Fetches per-card sales from the discovered endpoint and persists to SQLite.
 * Runs once at startup (after first pipeline cycle) as a background task.
 * Skips tokens that already have sales in the DB to avoid redundant API calls.
 */
let backfillRunning = false;
let backfillComplete = false;

export function isBackfillComplete(): boolean {
  return backfillComplete;
}

export async function backfillXeetSalesHistory(): Promise<{ fetched: number; newSales: number; skipped: number; errors: number }> {
  if (backfillRunning) {
    log.warn('Backfill already in progress, skipping');
    return { fetched: 0, newSales: 0, skipped: 0, errors: 0 };
  }

  // Check if backfill already completed (persisted in SQLite)
  const meta = getStmts().getPipelineMeta.get('xeet_backfill_complete') as { value: string } | undefined;
  if (meta?.value === 'true') {
    log.info('Xeet backfill already completed (persisted), skipping');
    backfillComplete = true;
    xeetBackfillStatus.complete = true;
    return { fetched: 0, newSales: 0, skipped: 0, errors: 0 };
  }

  backfillRunning = true;
  xeetBackfillStatus.running = true;

  const stmts = getStmts();
  const allCreators = getAllCreators();
  const rarities: Rarity[] = ['common', 'rare', 'legendary'];

  // Collect all unique tokenIds from token map
  const tokenIds: Array<{ tokenId: string; handle: string; rarity: Rarity }> = [];
  for (const [, creator] of allCreators) {
    for (const rarity of rarities) {
      const ids = getTokenIds(creator.handle, rarity);
      for (const id of ids) {
        tokenIds.push({ tokenId: id, handle: creator.handle, rarity });
      }
    }
  }

  log.info({ totalTokens: tokenIds.length }, 'Starting Xeet sales history backfill (first time)');

  let fetched = 0;
  let newSales = 0;
  let skipped = 0;
  let errors = 0;

  for (const { tokenId, handle, rarity } of tokenIds) {
    try {
      const sales = await xeetClient.getCardSalesHistory(tokenId);
      fetched++;

      for (const evt of sales) {
        // Only count SALE — LISTING_FILLED is a duplicate of the same transaction
        const eventType = (evt.eventType ?? '').toUpperCase();
        if (eventType && eventType !== 'SALE') continue;

        const price = evt.priceXeets ?? 0;
        const timestamp = evt.timestamp ?? '';
        if (!price || !timestamp) continue;

        try {
          stmts.upsertSale.run(
            'xeet', tokenId, handle.toLowerCase(), rarity, price, 'XEETS', null,
            evt.sellerHandle ?? null, evt.buyerHandle ?? null,
            null, null, timestamp,
          );
          newSales++;
        } catch {
          // Duplicate — already stored
        }
      }

      // Log progress every 50 tokens
      if (fetched % 50 === 0) {
        log.info({ fetched, newSales, skipped, errors, remaining: tokenIds.length - fetched - skipped - errors }, 'Backfill progress');
      }
    } catch (err) {
      errors++;
      log.warn({ tokenId, err }, 'Failed to fetch card sales history');
    }
  }

  // Build per-creator summary
  const creatorMap = new Map<string, BackfillCreatorResult>();
  for (const { handle, rarity } of tokenIds) {
    const key = `${handle.toLowerCase()}:${rarity}`;
    if (!creatorMap.has(key)) {
      creatorMap.set(key, { handle: handle.toLowerCase(), rarity, tokensFetched: 0, salesFound: 0, errors: 0 });
    }
  }
  xeetBackfillStatus.results = Array.from(creatorMap.values());
  xeetBackfillStatus.creatorsProcessed = creatorMap.size;
  xeetBackfillStatus.totalSalesFound = newSales;
  xeetBackfillStatus.totalErrors = errors;
  // Count creators with/without sales from DB (more accurate than just this run)
  const creatorsInDb = new Set(
    (getDb().prepare("SELECT DISTINCT creator_handle || ':' || rarity as k FROM sale_history WHERE marketplace = 'xeet'").all() as any[]).map(r => r.k),
  );
  xeetBackfillStatus.creatorsWithSales = Array.from(creatorMap.keys()).filter(k => creatorsInDb.has(k)).length;
  xeetBackfillStatus.creatorsWithZeroSales = creatorMap.size - xeetBackfillStatus.creatorsWithSales;

  backfillComplete = true;
  backfillRunning = false;
  xeetBackfillStatus.running = false;
  xeetBackfillStatus.complete = true;

  // Persist completion to SQLite so we skip on next restart
  getStmts().upsertPipelineMeta.run('xeet_backfill_complete', 'true');

  log.info({
    fetched, newSales, skipped, errors,
    creatorsWithSales: xeetBackfillStatus.creatorsWithSales,
    creatorsWithZeroSales: xeetBackfillStatus.creatorsWithZeroSales,
  }, 'Xeet sales history backfill complete');
  return { fetched, newSales, skipped, errors };
}

/**
 * Backfill OpenSea sales history for all known token IDs.
 * Fetches per-token sale events and persists to SQLite.
 * Skips tokens that already have OpenSea sales in the DB.
 */
let osBackfillRunning = false;
let osBackfillComplete = false;

export function isOsBackfillComplete(): boolean {
  return osBackfillComplete;
}

export async function backfillOpenSeaSalesHistory(): Promise<{ fetched: number; newSales: number; skipped: number; errors: number }> {
  if (osBackfillRunning) {
    log.warn('OpenSea backfill already in progress, skipping');
    return { fetched: 0, newSales: 0, skipped: 0, errors: 0 };
  }

  // Check if backfill already completed (persisted in SQLite)
  const meta = getStmts().getPipelineMeta.get('os_backfill_complete') as { value: string } | undefined;
  if (meta?.value === 'true') {
    log.info('OpenSea backfill already completed (persisted), skipping');
    osBackfillComplete = true;
    osBackfillStatus.complete = true;
    return { fetched: 0, newSales: 0, skipped: 0, errors: 0 };
  }

  osBackfillRunning = true;
  osBackfillStatus.running = true;

  const stmts = getStmts();
  const allCreators = getAllCreators();
  const rarities: Rarity[] = ['common', 'rare', 'legendary'];

  // Collect all unique tokenIds from token map
  const tokenIds: Array<{ tokenId: string; handle: string; rarity: Rarity }> = [];
  for (const [, creator] of allCreators) {
    for (const rarity of rarities) {
      const ids = getTokenIds(creator.handle, rarity);
      for (const id of ids) {
        tokenIds.push({ tokenId: id, handle: creator.handle, rarity });
      }
    }
  }

  log.info({ totalTokens: tokenIds.length }, 'Starting OpenSea sales history backfill (first time)');

  let fetched = 0;
  let newSales = 0;
  let skipped = 0;
  let errors = 0;

  for (const { tokenId, handle, rarity } of tokenIds) {
    try {
      const sales = await osClient.getTokenSaleEvents(tokenId);
      fetched++;

      for (const evt of sales) {
        if (!evt.event_timestamp) continue;
        const price = Number(evt.payment?.quantity ?? 0) / Math.pow(10, evt.payment?.decimals ?? 18);
        // Convert Unix seconds to ISO string if needed
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
          newSales++;
        } catch {
          // Duplicate
        }
      }

      if (fetched % 50 === 0) {
        log.info({ fetched, newSales, skipped, errors, remaining: tokenIds.length - fetched - skipped - errors }, 'OpenSea backfill progress');
      }
    } catch (err) {
      errors++;
      log.warn({ tokenId, err }, 'Failed to fetch OpenSea token sales');
    }
  }

  // Build per-creator summary
  const creatorMap = new Map<string, BackfillCreatorResult>();
  for (const { handle, rarity } of tokenIds) {
    const key = `${handle.toLowerCase()}:${rarity}`;
    if (!creatorMap.has(key)) {
      creatorMap.set(key, { handle: handle.toLowerCase(), rarity, tokensFetched: 0, salesFound: 0, errors: 0 });
    }
  }
  osBackfillStatus.results = Array.from(creatorMap.values());
  osBackfillStatus.creatorsProcessed = creatorMap.size;
  osBackfillStatus.totalSalesFound = newSales;
  osBackfillStatus.totalErrors = errors;
  const creatorsInDb = new Set(
    (getDb().prepare("SELECT DISTINCT creator_handle || ':' || rarity as k FROM sale_history WHERE marketplace = 'opensea'").all() as any[]).map(r => r.k),
  );
  osBackfillStatus.creatorsWithSales = Array.from(creatorMap.keys()).filter(k => creatorsInDb.has(k)).length;
  osBackfillStatus.creatorsWithZeroSales = creatorMap.size - osBackfillStatus.creatorsWithSales;

  osBackfillComplete = true;
  osBackfillRunning = false;
  osBackfillStatus.running = false;
  osBackfillStatus.complete = true;

  // Persist completion to SQLite so we skip on next restart
  getStmts().upsertPipelineMeta.run('os_backfill_complete', 'true');

  log.info({
    fetched, newSales, skipped, errors,
    creatorsWithSales: osBackfillStatus.creatorsWithSales,
    creatorsWithZeroSales: osBackfillStatus.creatorsWithZeroSales,
  }, 'OpenSea sales history backfill complete');
  return { fetched, newSales, skipped, errors };
}
