import { config } from '../config.js';
import { AdaptiveRateLimiter } from '../lib/rate-limiter.js';
import { withRetry } from '../lib/retry.js';
import { childLogger } from '../lib/logger.js';

const log = childLogger('opensea-client');
const limiter = new AdaptiveRateLimiter('opensea', 1, 4, 2);

const SLUG = config.opensea.collectionSlug;
const BASE = config.opensea.baseUrl;
const HEADERS = { 'X-API-KEY': config.opensea.apiKey, Accept: 'application/json' };

async function osFetch<T>(path: string, label: string): Promise<T | null> {
  await limiter.acquire();
  return withRetry(
    async () => {
      const url = `${BASE}${path}`;
      log.debug({ url }, `Fetching ${label}`);
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) {
        limiter.onError(res.status);
        if (res.status === 404) return null;
        throw new Error(`${label} failed: ${res.status} ${res.statusText}`);
      }
      limiter.onSuccess();
      return (await res.json()) as T;
    },
    { label, maxAttempts: 3, baseDelayMs: 1500 },
  );
}

// ---- Types ----

export interface OpenSeaOrder {
  order_hash: string;
  type: string;
  price: {
    current: { currency: string; decimals: number; value: string };
  };
  protocol_data: {
    parameters: {
      offer: Array<{ token: string; identifierOrCriteria: string; itemType: number }>;
      offerer: string;
      endTime: string;
      startTime: string;
    };
  };
  protocol_address: string;
  closing_date?: string;
}

export interface OpenSeaListingsResponse {
  listings: OpenSeaOrder[];
  next?: string;
}

export interface OpenSeaOffersResponse {
  offers: OpenSeaOrder[];
  next?: string;
}

export interface OpenSeaSaleEvent {
  event_type: string;
  event_timestamp: string;
  order_hash?: string;
  payment: { quantity: string; token_address: string; decimals: number; symbol: string };
  seller: string;
  buyer: string;
  nft: { identifier: string; collection: string; contract: string; token_standard: string; name?: string; image_url?: string };
  transaction?: string;
}

export interface OpenSeaEventsResponse {
  asset_events: OpenSeaSaleEvent[];
  next?: string;
}

export interface OpenSeaNFT {
  identifier: string;
  collection: string;
  contract: string;
  token_standard: string;
  name: string | null;
  description: string | null;
  image_url: string | null;
  traits: Array<{ trait_type: string; value: string | number }>;
}

export interface OpenSeaNFTsResponse {
  nfts: OpenSeaNFT[];
  next?: string;
}

export interface OpenSeaCollectionStats {
  total: {
    volume: number;
    sales: number;
    average_price: number;
    num_owners: number;
    market_cap: number;
    floor_price: number;
    floor_price_symbol: string;
  };
  intervals: Array<{
    interval: string;
    volume: number;
    volume_diff: number;
    volume_change: number;
    sales: number;
    sales_diff: number;
    average_price: number;
    floor_price?: number;
    floor_price_symbol?: string;
  }>;
}

// ---- API Methods ----

export async function getAllListings(maxPages = 20): Promise<OpenSeaOrder[]> {
  const allListings: OpenSeaOrder[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('next', cursor);

    const data = await osFetch<OpenSeaListingsResponse>(
      `/api/v2/listings/collection/${SLUG}/all?${params}`,
      `os-listings-page-${page}`,
    );
    if (!data || !data.listings?.length) break;

    allListings.push(...data.listings);
    if (!data.next) break;
    cursor = data.next;
  }

  log.info({ count: allListings.length }, 'Fetched all OpenSea listings');
  return allListings;
}

export async function getAllOffers(maxPages = 20): Promise<OpenSeaOrder[]> {
  const allOffers: OpenSeaOrder[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('next', cursor);

    const data = await osFetch<OpenSeaOffersResponse>(
      `/api/v2/offers/collection/${SLUG}/all?${params}`,
      `os-offers-page-${page}`,
    );
    if (!data || !data.offers?.length) break;

    allOffers.push(...data.offers);
    if (!data.next) break;
    cursor = data.next;
  }

  log.info({ count: allOffers.length }, 'Fetched all OpenSea offers');
  return allOffers;
}

export async function getSaleEvents(limit = 50): Promise<OpenSeaSaleEvent[]> {
  const data = await osFetch<OpenSeaEventsResponse>(
    `/api/v2/events/collection/${SLUG}?event_type=sale&limit=${limit}`,
    'os-sale-events',
  );
  return data?.asset_events ?? [];
}

export async function getCollectionStats(): Promise<OpenSeaCollectionStats | null> {
  return osFetch<OpenSeaCollectionStats>(
    `/api/v2/collections/${SLUG}/stats`,
    'os-collection-stats',
  );
}

export async function getAllNFTs(maxPages = 50): Promise<OpenSeaNFT[]> {
  const allNFTs: OpenSeaNFT[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('next', cursor);

    const data = await osFetch<OpenSeaNFTsResponse>(
      `/api/v2/collection/${SLUG}/nfts?${params}`,
      `os-nfts-page-${page}`,
    );
    if (!data || !data.nfts?.length) break;

    allNFTs.push(...data.nfts);
    if (!data.next) break;
    cursor = data.next;
  }

  log.info({ count: allNFTs.length }, 'Fetched all OpenSea NFTs');
  return allNFTs;
}

// ---- Helpers ----

export function extractTokenId(order: OpenSeaOrder): string | null {
  const offer = order.protocol_data?.parameters?.offer?.[0];
  return offer?.identifierOrCriteria ?? null;
}

export function extractEthPrice(order: OpenSeaOrder): number {
  const price = order.price?.current;
  if (!price) return 0;
  const value = BigInt(price.value);
  const decimals = price.decimals || 18;
  return Number(value) / Math.pow(10, decimals);
}

export function extractOrderExpiry(order: OpenSeaOrder): Date | null {
  const endTime = order.protocol_data?.parameters?.endTime;
  if (!endTime) return null;
  return new Date(parseInt(endTime) * 1000);
}
