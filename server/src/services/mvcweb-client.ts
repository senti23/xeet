import { config } from '../config.js';
import { AdaptiveRateLimiter } from '../lib/rate-limiter.js';
import { withRetry } from '../lib/retry.js';
import { childLogger } from '../lib/logger.js';

const log = childLogger('mvcweb-client');
const limiter = new AdaptiveRateLimiter('mvcweb', 1, 5, 2);

const BASE = config.xeet.mvcBaseUrl;

async function mvcFetch<T>(path: string, label: string): Promise<T | null> {
  await limiter.acquire();
  return withRetry(
    async () => {
      const url = `${BASE}${path}`;
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

export interface MvcCreator {
  xHandle: string;
  displayName?: string;
  walletAddress?: string;
  followers?: number;
  bio?: string;
  ethosScore?: number;
  credScore?: number;
  cards?: {
    totalIssued: number;
    totalSupply: number;
    uniqueCollectors: number;
    commonSupply: number;
    rareSupply: number;
    legendarySupply: number;
  };
}

export interface MvcCard {
  tokenId: string;
  creatorHandle: string;
  rarity: string;
  name?: string;
  imageUrl?: string;
  supply?: number;
}

interface MvcCreatorsPage {
  data?: MvcCreator[];
  results?: MvcCreator[];
  creators?: MvcCreator[];
}

export async function getAllCreators(maxPages = 20, pageSize = 20): Promise<MvcCreator[]> {
  const all: MvcCreator[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const data = await mvcFetch<MvcCreatorsPage | MvcCreator[]>(
      `/api/creators?page=${page}&limit=${pageSize}`,
      `mvc-creators-page-${page}`,
    );
    if (!data) break;

    const items = Array.isArray(data)
      ? data
      : data.data || data.results || data.creators || [];

    if (items.length === 0) break;
    all.push(...items);
    if (items.length < pageSize) break;
  }

  log.info({ count: all.length }, 'Fetched all MVC creators');
  return all;
}

export async function getCreator(handle: string): Promise<MvcCreator | null> {
  return mvcFetch<MvcCreator>(`/api/creators/${handle}`, `mvc-creator-${handle}`);
}

export async function getCardsByRarity(rarity: 'common' | 'rare' | 'legendary'): Promise<MvcCard[]> {
  const data = await mvcFetch<MvcCard[] | { cards?: MvcCard[]; data?: MvcCard[] }>(
    `/api/cards?rarity=${rarity}`,
    `mvc-cards-${rarity}`,
  );
  if (!data) return [];
  if (Array.isArray(data)) return data;
  return data.cards || data.data || [];
}
