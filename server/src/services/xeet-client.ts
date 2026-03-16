import { config } from '../config.js';
import { AdaptiveRateLimiter } from '../lib/rate-limiter.js';
import { withRetry } from '../lib/retry.js';
import { childLogger } from '../lib/logger.js';

const log = childLogger('xeet-client');
const limiter = new AdaptiveRateLimiter('xeet', 1, 5, 2);

export interface XeetListing {
  id: string;
  orderHash: string;
  sellerId: string;
  sellerWalletAddress: string;
  sellerHandle?: string;
  tokenContract: string;
  tokenId: string;
  tokenType: 'CARD' | 'PACK';
  xeetPrice: number;
  creatorId: string;
  creatorHandle?: string;
  rarity: string;
  assetName?: string;
  sellerSignature?: string;
  deadline?: string;
  status: string;
  createdAt?: string;
  // Nested objects from API
  seller?: { id: string; handle: string; name: string };
  creator?: { id: string; handle: string; displayName: string };
}

interface XeetApiResponse {
  success: boolean;
  data: {
    items: XeetListing[];
    pagination?: { total: number; limit: number; offset: number; hasMore: boolean };
  };
}

export interface XeetListingsResponse {
  items: XeetListing[];
  total?: number;
  page?: number;
  hasMore?: boolean;
}

export interface XeetActivityEvent {
  eventType: 'LISTING_CANCELLED' | 'SALE' | 'LISTING' | 'LISTING_FILLED' | 'LISTING_CREATED';
  tokenType: string;
  tokenId: string;
  assetName: string;
  rarity: string;
  priceXeets: number;
  sellerHandle?: string;
  buyerHandle?: string;
  timestamp: string;
  creatorId?: string;
  creatorHandle?: string;
}

/**
 * Normalize a timestamp to a consistent ISO format (no milliseconds) to prevent
 * duplicate records caused by format differences between API endpoints.
 * e.g. "2024-01-15T10:30:00.000Z" → "2024-01-15T10:30:00Z"
 */
export function normalizeTimestamp(ts: string): string {
  if (!ts) return ts;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  // Truncate to second precision for consistent dedup
  d.setMilliseconds(0);
  return d.toISOString().replace('.000Z', 'Z');
}

async function xeetFetch<T>(path: string, label: string): Promise<T | null> {
  await limiter.acquire();
  return withRetry(
    async () => {
      const url = `${config.xeet.baseUrl}${path}`;
      log.debug({ url }, `Fetching ${label}`);
      const res = await fetch(url);
      if (!res.ok) {
        limiter.onError(res.status);
        if (res.status === 404) return null;
        throw new Error(`${label} failed: ${res.status} ${res.statusText}`);
      }
      limiter.onSuccess();
      return (await res.json()) as T;
    },
    { label, maxAttempts: 3 },
  );
}

export async function getActiveListings(): Promise<XeetListing[]> {
  const allItems: XeetListing[] = [];
  const pageSize = 250;
  const MAX_PAGES = 50;

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * pageSize;
    const data = await xeetFetch<XeetApiResponse | XeetListingsResponse | XeetListing[]>(
      `/api/marketplace/discovery/items?status=ACTIVE&sortBy=price_asc&limit=${pageSize}&offset=${offset}`,
      `xeet-listings-page-${page}`,
    );
    if (!data) break;
    if (Array.isArray(data)) {
      allItems.push(...data);
      break; // Raw array means no pagination info
    }

    // API returns { success, data: { items: [...], pagination: { hasMore } } }
    let items: XeetListing[] | undefined;
    let hasMore = false;
    if ('data' in data && (data as XeetApiResponse).data?.items) {
      items = (data as XeetApiResponse).data.items;
      hasMore = (data as XeetApiResponse).data.pagination?.hasMore ?? false;
    } else if ('items' in data) {
      items = (data as XeetListingsResponse).items;
      hasMore = (data as XeetListingsResponse).hasMore ?? false;
    }

    if (!items || items.length === 0) break;

    // Flatten nested creator.handle into creatorHandle for pipeline compatibility
    for (const item of items) {
      if (!item.creatorHandle && item.creator?.handle) {
        item.creatorHandle = item.creator.handle;
      }
      if (!item.sellerHandle && item.seller?.handle) {
        item.sellerHandle = item.seller.handle;
      }
    }

    allItems.push(...items);
    if (!hasMore) break;
  }

  log.info({ count: allItems.length }, 'Xeet listings fetched');
  return allItems.filter((i) => i.tokenType === 'CARD');
}

export async function getActivity(): Promise<XeetActivityEvent[]> {
  const allEvents: XeetActivityEvent[] = [];
  const pageSize = 250;
  const MAX_PAGES = 50;

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * pageSize;
    const data = await xeetFetch<any>(
      `/api/marketplace/discovery/activity?eventType=SALE&limit=${pageSize}&offset=${offset}`,
      `xeet-activity-page-${page}`,
    );
    if (!data) break;

    // API returns { success, data: [...] } where data is directly an array
    let events: XeetActivityEvent[] | undefined;
    if (Array.isArray(data)) {
      events = data;
    } else if (Array.isArray(data.data)) {
      events = data.data;
    } else if (data.data?.events) {
      events = data.data.events;
    } else if (data.events) {
      events = data.events;
    }

    if (!events || events.length === 0) break;

    // Flatten nested creator handle if present + normalize timestamps
    for (const evt of events) {
      if (!evt.creatorHandle && (evt as any).creator?.handle) {
        evt.creatorHandle = (evt as any).creator.handle;
      }
      if (evt.timestamp) {
        evt.timestamp = normalizeTimestamp(evt.timestamp);
      }
    }

    allEvents.push(...events);

    // If we got fewer than requested, no more pages
    if (events.length < pageSize) break;
  }

  log.info({ count: allEvents.length }, 'Xeet activity fetched');
  return allEvents;
}

/**
 * Fetch full sales history for a specific card by tokenId.
 * Uses the per-card activity endpoint discovered via network intercept:
 *   /api/marketplace/discovery/activity?tokenType=CARD&tokenId={id}&limit=100&eventType=SALE
 * Paginates via offset until all sales are retrieved.
 */
export async function getCardSalesHistory(tokenId: string): Promise<XeetActivityEvent[]> {
  const allEvents: XeetActivityEvent[] = [];
  const pageSize = 100;
  const MAX_PAGES = 50;

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * pageSize;
    const data = await xeetFetch<any>(
      `/api/marketplace/discovery/activity?tokenType=CARD&tokenId=${tokenId}&limit=${pageSize}&offset=${offset}&eventType=SALE`,
      `xeet-card-history-${tokenId}-page-${page}`,
    );
    if (!data) break;

    let events: XeetActivityEvent[] | undefined;
    if (Array.isArray(data)) {
      events = data;
    } else if (Array.isArray(data.data)) {
      events = data.data;
    } else if (data.data?.events) {
      events = data.data.events;
    } else if (data.events) {
      events = data.events;
    }

    if (!events || events.length === 0) break;

    for (const evt of events) {
      if (!evt.creatorHandle && (evt as any).creator?.handle) {
        evt.creatorHandle = (evt as any).creator.handle;
      }
      if (evt.timestamp) {
        evt.timestamp = normalizeTimestamp(evt.timestamp);
      }
    }

    allEvents.push(...events);
    if (events.length < pageSize) break;
  }

  log.info({ tokenId, count: allEvents.length }, 'Card sales history fetched');
  return allEvents;
}
