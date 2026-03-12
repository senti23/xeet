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

export async function getActiveListings(limit = 250): Promise<XeetListing[]> {
  const data = await xeetFetch<XeetListingsResponse | XeetListing[]>(
    `/api/marketplace/discovery/items?status=ACTIVE&sortBy=price_asc&limit=${limit}`,
    'xeet-listings',
  );
  if (!data) return [];
  // Handle both possible shapes: { items: [...] } or raw array
  if (Array.isArray(data)) return data.filter((i) => i.tokenType === 'CARD');
  if (data.items) return data.items.filter((i) => i.tokenType === 'CARD');
  return [];
}

export async function getActivity(limit = 96): Promise<XeetActivityEvent[]> {
  const data = await xeetFetch<XeetActivityEvent[] | { events?: XeetActivityEvent[] }>(
    `/api/marketplace/discovery/activity?limit=${limit}`,
    'xeet-activity',
  );
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if ('events' in data && data.events) return data.events;
  return [];
}
