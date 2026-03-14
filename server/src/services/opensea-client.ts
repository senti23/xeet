import { config } from '../config.js';
import { AdaptiveRateLimiter } from '../lib/rate-limiter.js';
import { withRetry } from '../lib/retry.js';
import { childLogger } from '../lib/logger.js';

const log = childLogger('opensea-client');
const limiter = new AdaptiveRateLimiter('opensea', 1, 4, 2);

const SLUG = config.opensea.collectionSlug;
const CONTRACT = config.opensea.contract;
const CHAIN = 'abstract'; // Contract is deployed on Abstract chain
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

export interface SeaportItem {
  token: string;
  identifierOrCriteria: string;
  itemType: number; // 0=ETH, 1=ERC20, 2=ERC721, 3=ERC1155, 4=ERC721_CRITERIA, 5=ERC1155_CRITERIA
  startAmount?: string;
  endAmount?: string;
  recipient?: string;
}

export interface OpenSeaOrder {
  order_hash: string;
  type: string;
  price: {
    current: { currency: string; decimals: number; value: string };
  };
  protocol_data: {
    parameters: {
      offer: SeaportItem[];
      consideration: SeaportItem[];
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

export async function getAllListings(): Promise<OpenSeaOrder[]> {
  const allListings: OpenSeaOrder[] = [];
  let cursor: string | undefined;

  for (let page = 0; ; page++) {
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

export async function getAllOffers(): Promise<OpenSeaOrder[]> {
  const allOffers: OpenSeaOrder[] = [];
  let cursor: string | undefined;

  for (let page = 0; ; page++) {
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

export async function getSaleEvents(): Promise<OpenSeaSaleEvent[]> {
  const allEvents: OpenSeaSaleEvent[] = [];
  let cursor: string | undefined;

  for (let page = 0; ; page++) {
    const params = new URLSearchParams({ event_type: 'sale', limit: '200' });
    if (cursor) params.set('next', cursor);

    const data = await osFetch<OpenSeaEventsResponse>(
      `/api/v2/events/collection/${SLUG}?${params}`,
      `os-sale-events-page-${page}`,
    );
    if (!data || !data.asset_events?.length) break;

    allEvents.push(...data.asset_events);
    if (!data.next) break;
    cursor = data.next;
  }

  log.info({ count: allEvents.length }, 'Fetched OpenSea sale events');
  return allEvents;
}

export async function getCollectionStats(): Promise<OpenSeaCollectionStats | null> {
  return osFetch<OpenSeaCollectionStats>(
    `/api/v2/collections/${SLUG}/stats`,
    'os-collection-stats',
  );
}

async function fetchNFTsFromEndpoint(urlPrefix: string, label: string): Promise<OpenSeaNFT[]> {
  const allNFTs: OpenSeaNFT[] = [];
  let cursor: string | undefined;

  for (let page = 0; ; page++) {
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('next', cursor);

    const data = await osFetch<OpenSeaNFTsResponse>(
      `${urlPrefix}?${params}`,
      `${label}-page-${page}`,
    );
    if (!data || !data.nfts?.length) break;

    allNFTs.push(...data.nfts);
    if (!data.next) break;
    cursor = data.next;
  }

  return allNFTs;
}

export async function getAllNFTs(): Promise<OpenSeaNFT[]> {
  // Try collection endpoint first
  let allNFTs = await fetchNFTsFromEndpoint(
    `/api/v2/collection/${SLUG}/nfts`,
    'os-nfts-collection',
  );
  log.info({ count: allNFTs.length }, 'Fetched NFTs from collection endpoint');

  // Also try contract-based endpoint on Abstract chain to catch any missing NFTs
  try {
    const contractNFTs = await fetchNFTsFromEndpoint(
      `/api/v2/chain/${CHAIN}/contract/${CONTRACT}/nfts`,
      'os-nfts-contract',
    );
    log.info({ count: contractNFTs.length }, 'Fetched NFTs from contract endpoint');

    // Merge: add any NFTs from contract endpoint not already in collection results
    const existingIds = new Set(allNFTs.map((n) => n.identifier));
    let added = 0;
    for (const nft of contractNFTs) {
      if (!existingIds.has(nft.identifier)) {
        allNFTs.push(nft);
        added++;
      }
    }
    if (added > 0) {
      log.info({ added, total: allNFTs.length }, 'Merged additional NFTs from contract endpoint');
    }
  } catch (err) {
    log.warn({ err }, 'Contract NFT endpoint failed, using collection endpoint only');
  }

  log.info({ count: allNFTs.length }, 'Total OpenSea NFTs fetched');
  return allNFTs;
}

// ---- Helpers ----

/**
 * Extract token ID from an order.
 * For LISTINGS: the NFT is in offer[0] (itemType 2=ERC721, 3=ERC1155)
 * For OFFERS: the NFT is in consideration[] (itemType 2/3 for token-specific, 4/5 for collection/criteria)
 */
export function extractTokenId(order: OpenSeaOrder): string | null {
  const params = order.protocol_data?.parameters;
  if (!params) return null;

  // Check offer items for NFTs (listings)
  for (const item of params.offer ?? []) {
    if (item.itemType === 2 || item.itemType === 3) {
      // ERC721 or ERC1155 — this is a listing
      return item.identifierOrCriteria ?? null;
    }
  }

  // Check consideration items for NFTs (offers)
  for (const item of params.consideration ?? []) {
    if (item.itemType === 2 || item.itemType === 3) {
      // Specific token offer
      return item.identifierOrCriteria ?? null;
    }
    // itemType 4/5 = criteria-based (collection/trait offers) — identifierOrCriteria is merkle root or "0"
    // These can't be mapped to specific tokens
  }

  return null;
}

/**
 * Check if an offer is collection-wide (criteria-based, applies to all tokens).
 * These have itemType 4/5 in consideration and no specific token ID.
 */
export function isCollectionOffer(order: OpenSeaOrder): boolean {
  const params = order.protocol_data?.parameters;
  if (!params) return false;

  for (const item of params.consideration ?? []) {
    if (item.itemType === 4 || item.itemType === 5) {
      return true;
    }
  }
  return false;
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
