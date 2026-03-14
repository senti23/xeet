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
  eventType: 'LISTING_CANCELLED' | 'SALE' | 'LISTING';
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

export async function getActiveListings(maxPages = 10): Promise<XeetListing[]> {
  const allItems: XeetListing[] = [];
  const pageSize = 250;

  for (let page = 0; page < maxPages; page++) {
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

export async function getActivity(limit = 96): Promise<XeetActivityEvent[]> {
  const data = await xeetFetch<any>(
    `/api/marketplace/discovery/activity?limit=${limit}`,
    'xeet-activity',
  );
  if (!data) return [];

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

  if (!events) {
    log.warn({ responseKeys: Object.keys(data), dataType: typeof data.data }, 'Unexpected activity response shape');
    return [];
  }

  // Flatten nested creator handle if present
  for (const evt of events) {
    if (!evt.creatorHandle && (evt as any).creator?.handle) {
      evt.creatorHandle = (evt as any).creator.handle;
    }
  }

  log.info({ count: events.length }, 'Xeet activity parsed');
  return events;
}
