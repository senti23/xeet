import { config } from '../config.js';
import { childLogger } from '../lib/logger.js';
import { getStmts } from '../db/index.js';
import * as xeetClient from './xeet-client.js';
import * as osClient from './opensea-client.js';
import { getCreatorRarity, getAllCreators, type Rarity } from './token-map.js';
import { fetchEthUsdRate, ethToUsd, getEthUsdRate } from './price-service.js';
import { backfillHolders, refreshHolders } from './holder-service.js';
import { backfillFromChain, syncXeetSales, isOnchainBackfillComplete } from './onchain-sales.js';

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
    const [xeetListings, osListings, osOffers, osSaleEvents] = await Promise.all([
      xeetClient.getActiveListings().catch((e) => {
        log.error({ err: e }, 'Xeet listings fetch failed');
        return [] as xeetClient.XeetListing[];
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

    const stmts = getStmts();

    // --- On-chain Xeet sales sync (incremental from last block) ---
    const xeetSyncResult = await syncXeetSales().catch((e) => {
      log.error({ err: e }, 'Xeet on-chain sync failed');
      return { xeetNew: 0, osNew: 0, inserted: 0 };
    });

    // --- Persist new OS sales from osSaleEvents (fetched above) ---
    let osInserted = 0;
    for (const evt of osSaleEvents) {
      const tokenId = evt.nft?.identifier;
      if (!tokenId) continue;
      const mapping = getCreatorRarity(tokenId);
      if (!mapping) continue;
      const price = Number(evt.payment?.quantity ?? 0) / Math.pow(10, evt.payment?.decimals ?? 18);
      const soldAt = new Date(Number(evt.event_timestamp) * 1000).toISOString();
      try {
        const r = stmts.upsertSale.run(
          'opensea', tokenId, mapping.handle.toLowerCase(), mapping.rarity,
          price, evt.payment?.symbol ?? 'ETH', null,
          evt.seller ?? null, evt.buyer ?? null,
          evt.order_hash ?? null, evt.transaction ?? null, soldAt,
        );
        if (r.changes > 0) osInserted++;
      } catch { /* dedup constraint */ }
    }

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
        osListings: osListings.length,
        osOffers: osOffers.length,
        xeetSync: xeetSyncResult,
        osInserted,
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

      // Kick off on-chain sales backfill (single pass from block 0)
      backfillFromChain()
        .then((r) => {
          if (r) log.info({ ...r }, 'On-chain sales backfill complete');
        })
        .catch((err) => log.error({ err }, 'On-chain sales backfill error'));
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
        .then(() => log.info('Holder refresh complete'))
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

// --- Compatibility stubs for old backfill status API ---
// Used by api/sales.ts and index.ts

export function isBackfillComplete(): boolean {
  return isOnchainBackfillComplete();
}

export function isOsBackfillComplete(): boolean {
  return isOnchainBackfillComplete();
}

export function getBackfillStatus(): {
  xeet: { running: boolean; complete: boolean; creatorsProcessed: number; creatorsWithSales: number; creatorsWithZeroSales: number; totalErrors: number; totalSalesFound: number; results: never[] };
  opensea: { running: boolean; complete: boolean; creatorsProcessed: number; creatorsWithSales: number; creatorsWithZeroSales: number; totalErrors: number; totalSalesFound: number; results: never[] };
} {
  const complete = isOnchainBackfillComplete();
  const stub = {
    running: false,
    complete,
    creatorsProcessed: 0,
    creatorsWithSales: 0,
    creatorsWithZeroSales: 0,
    totalErrors: 0,
    totalSalesFound: 0,
    results: [] as never[],
  };
  return { xeet: { ...stub }, opensea: { ...stub } };
}
