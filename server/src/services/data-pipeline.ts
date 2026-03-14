import { config } from '../config.js';
import { childLogger } from '../lib/logger.js';
import * as xeetClient from './xeet-client.js';
import * as osClient from './opensea-client.js';
import { getCreatorRarity, getAllCreators, type Rarity } from './token-map.js';
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

    // Xeet last sales by creator+rarity
    const xeetLastSale = new Map<string, { price: number; date: string }>();
    for (const evt of xeetActivity) {
      if (evt.eventType !== 'SALE') continue;
      // Try creatorHandle first, then fall back to token map lookup
      let cr = evt.creatorHandle || evt.creatorId;
      let rarity = evt.rarity?.toLowerCase();
      if ((!cr || !rarity) && evt.tokenId) {
        const mapping = getCreatorRarity(evt.tokenId);
        if (mapping) {
          cr = cr || mapping.handle;
          rarity = rarity || mapping.rarity;
        }
      }
      if (!cr || !rarity) continue;
      const k = key(cr, rarity);
      const existing = xeetLastSale.get(k);
      if (!existing || evt.timestamp > existing.date) {
        xeetLastSale.set(k, { price: evt.priceXeets, date: evt.timestamp });
      }
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
    const offersByKey = new Map<string, number>();
    let offersMapped = 0;
    let offersUnmapped = 0;
    for (const offer of osOffers) {
      const tokenId = osClient.extractTokenId(offer);
      if (!tokenId) continue;
      const mapping = getCreatorRarity(tokenId);
      if (!mapping) { offersUnmapped++; continue; }
      offersMapped++;
      const k = key(mapping.handle, mapping.rarity);
      const ethPrice = osClient.extractEthPrice(offer);
      const existing = offersByKey.get(k) ?? 0;
      if (ethPrice > existing) {
        offersByKey.set(k, ethPrice);
      }
    }

    if (offersUnmapped > 0) {
      log.warn({
        total: osOffers.length,
        mapped: offersMapped,
        unmapped: offersUnmapped,
      }, 'OS offers token mapping stats');
    }

    // OpenSea last sales
    const osLastSale = new Map<string, { price: number; date: string }>();
    for (const evt of osSaleEvents) {
      const tokenId = evt.nft?.identifier;
      if (!tokenId) continue;
      const mapping = getCreatorRarity(tokenId);
      if (!mapping) continue;
      const k = key(mapping.handle, mapping.rarity);
      const price = Number(evt.payment?.quantity ?? 0) / Math.pow(10, evt.payment?.decimals ?? 18);
      const existing = osLastSale.get(k);
      if (!existing || evt.event_timestamp > existing.date) {
        osLastSale.set(k, { price, date: evt.event_timestamp });
      }
    }

    // --- Build cache entries for all creators × rarities ---
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

        // Best offer
        const bestOffer = offersByKey.get(k) ?? null;

        // Last sales
        const xeetSale = xeetLastSale.get(k);
        const osSale = osLastSale.get(k);

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
          lastSaleXeet: xeetSale?.price ?? null,
          lastSaleXeetDate: xeetSale?.date ?? null,
          lastSaleOs: osSale?.price ?? null,
          lastSaleOsDate: osSale?.date ?? null,
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
