import { config } from '../config.js';
import { childLogger } from '../lib/logger.js';
import { getDb, getStmts } from '../db/index.js';
import * as xeetClient from './xeet-client.js';
import * as osClient from './opensea-client.js';
import { getCreatorRarity, getAllCreators, getTokenIds, type Rarity } from './token-map.js';
import { fetchEthUsdRate, ethToUsd, getEthUsdRate } from './price-service.js';

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
      osClient.getSaleEvents().catch((e) => {
        log.error({ err: e }, 'OpenSea sale events fetch failed');
        return [] as osClient.OpenSeaSaleEvent[];
      }),
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
      const timestamp = evt.timestamp ?? '';
      if (!tokenId || !price || !timestamp) { xeetSalesSkipped++; continue; }

      // Resolve creator+rarity from token map
      let cr = evt.creatorHandle || evt.creatorId;
      let rarity = (evt.rarity ?? '').toLowerCase();
      if ((!cr || !rarity) && tokenId) {
        const mapping = getCreatorRarity(tokenId);
        if (mapping) {
          cr = cr || mapping.handle;
          rarity = rarity || mapping.rarity;
        }
      }
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
      try {
        stmts.upsertSale.run(
          'opensea', tokenId, mapping.handle.toLowerCase(), mapping.rarity, price,
          evt.payment?.symbol ?? 'ETH', null,
          evt.seller ?? null, evt.buyer ?? null,
          evt.order_hash ?? null, evt.transaction ?? null, evt.event_timestamp,
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

  // Run first cycle immediately
  await runCycle();

  // Kick off Xeet sales history backfill in background (non-blocking)
  backfillXeetSalesHistory().catch((err) => log.error({ err }, 'Backfill error'));

  // Schedule subsequent cycles
  intervalId = setInterval(() => {
    runCycle().catch((err) => log.error({ err }, 'Pipeline interval error'));
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
  backfillRunning = true;

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

  log.info({ totalTokens: tokenIds.length }, 'Starting Xeet sales history backfill');

  // Check which tokens already have sales — skip those to avoid redundant fetches
  const tokensWithSales = new Set<string>();
  const rows = getDb().prepare('SELECT DISTINCT token_id FROM sale_history WHERE marketplace = ?').all('xeet') as Array<{ token_id: string }>;
  for (const r of rows) tokensWithSales.add(r.token_id);

  let fetched = 0;
  let newSales = 0;
  let skipped = 0;
  let errors = 0;

  for (const { tokenId, handle, rarity } of tokenIds) {
    // Skip tokens that already have Xeet sales persisted
    if (tokensWithSales.has(tokenId)) {
      skipped++;
      continue;
    }

    try {
      const sales = await xeetClient.getCardSalesHistory(tokenId);
      fetched++;

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

  backfillComplete = true;
  backfillRunning = false;
  log.info({ fetched, newSales, skipped, errors }, 'Xeet sales history backfill complete');
  return { fetched, newSales, skipped, errors };
}
