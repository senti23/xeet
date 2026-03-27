/**
 * deck.ts — API routes for deck reach score features.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { FastifyInstance } from 'fastify';
import {
  getRefreshStatus, triggerManualRefresh, getLastRefreshTime,
  getCachedDeckScores, getCachedDeckDetail, getCachedFloorPrices,
  getCachedCreatorHoldings,
} from '../services/deck-refresh.js';
import { getCache } from '../services/data-pipeline.js';
import { computeMissingForAPI, type CreatorHoldingsMap, type WalletDetail } from '../services/deck-missing.js';
import { childLogger } from '../lib/logger.js';
import { config } from '../config.js';

const log = childLogger('deck-api');
const __dirname = dirname(fileURLToPath(import.meta.url));

// Use config.dataDir for data files, fallback to repo root
const DATA_DIR = config.dataDir;
const REPO_ROOT = resolve(__dirname, '../../..');
const DETAIL_PATH = resolve(REPO_ROOT, 'web/public/data/deck-scores-detail.json');
const CREATOR_HOLDINGS_PATH = resolve(DATA_DIR, 'creator-holdings.json');
const CREATORS_FULL_PATH = resolve(DATA_DIR, 'xeet-creators-full.json');

// Cached data — loaded lazily, refreshed when files change
let cachedCreatorHoldings: CreatorHoldingsMap | null = null;
let cachedAllCreators: Array<{ handle: string; displayName: string }> | null = null;
let cachedDetail: Record<string, WalletDetail> | null = null;
let detailLoadedAt = 0;

function loadCreatorHoldings(): CreatorHoldingsMap {
  // Prefer live data from deck-refresh (rebuilt from DB every 10 min)
  const live = getCachedCreatorHoldings() as CreatorHoldingsMap | null;
  if (live) return live;

  // Fallback to static file (first load before refresh runs)
  if (cachedCreatorHoldings) return cachedCreatorHoldings;
  log.info({ path: CREATOR_HOLDINGS_PATH }, 'Loading creator-holdings.json (static fallback)');
  cachedCreatorHoldings = JSON.parse(readFileSync(CREATOR_HOLDINGS_PATH, 'utf-8'));
  return cachedCreatorHoldings!;
}

function loadAllCreators(): Array<{ handle: string; displayName: string }> {
  if (cachedAllCreators) return cachedAllCreators;
  log.info({ path: CREATORS_FULL_PATH }, 'Loading xeet-creators-full.json');
  const raw = JSON.parse(readFileSync(CREATORS_FULL_PATH, 'utf-8')) as Array<{ xHandle: string; displayName: string }>;
  cachedAllCreators = raw.map(c => ({ handle: c.xHandle.toLowerCase(), displayName: c.displayName }));
  return cachedAllCreators;
}

function loadDetail(): Record<string, WalletDetail> {
  // Try in-memory cache from deck-refresh first (production uses this)
  const memoryCache = getCachedDeckDetail() as Record<string, WalletDetail> | null;
  if (memoryCache) return memoryCache;

  // Fallback to file (development)
  const now = Date.now();
  if (cachedDetail && now - detailLoadedAt < 120_000) return cachedDetail;

  if (!existsSync(DETAIL_PATH)) {
    log.warn({ path: DETAIL_PATH }, 'deck-scores-detail.json not found');
    return {};
  }
  log.info({ path: DETAIL_PATH }, 'Loading deck-scores-detail.json');
  cachedDetail = JSON.parse(readFileSync(DETAIL_PATH, 'utf-8'));
  detailLoadedAt = now;
  return cachedDetail!;
}

export async function deckRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/deck/status — refresh metadata
  app.get('/api/deck/status', async () => {
    return getRefreshStatus();
  });

  // POST /api/deck/refresh — manual trigger (5-min rate limit)
  app.post('/api/deck/refresh', async (_req, reply) => {
    const result = await triggerManualRefresh();
    if ('error' in result) {
      return reply.status(429).send(result);
    }
    return result;
  });

  // ─── Data-serving endpoints (for production frontend) ──────────────────

  // GET /api/deck/scores — deck-scores.json from memory cache
  app.get('/api/deck/scores', async (_req, reply) => {
    const data = getCachedDeckScores();
    if (!data) {
      // Fallback: try loading from static file
      try {
        const filePath = resolve(DATA_DIR, '..', 'web', 'public', 'data', 'deck-scores.json');
        if (existsSync(filePath)) {
          return JSON.parse(readFileSync(filePath, 'utf-8'));
        }
      } catch {}
      return reply.status(503).send({ error: 'Deck scores not yet computed. Try again after first refresh cycle.' });
    }
    return data;
  });

  // GET /api/deck/scores/detail — deck-scores-detail.json from memory cache
  app.get('/api/deck/scores/detail', async (_req, reply) => {
    const data = getCachedDeckDetail();
    if (!data) {
      try {
        const filePath = resolve(DATA_DIR, '..', 'web', 'public', 'data', 'deck-scores-detail.json');
        if (existsSync(filePath)) {
          return JSON.parse(readFileSync(filePath, 'utf-8'));
        }
      } catch {}
      return reply.status(503).send({ error: 'Detail data not yet computed.' });
    }
    return data;
  });

  // GET /api/deck/floor-prices — floor-prices.json from memory cache
  app.get('/api/deck/floor-prices', async (_req, reply) => {
    const data = getCachedFloorPrices();
    if (!data) return reply.status(503).send({ error: 'Floor prices not yet computed.' });
    return data;
  });

  // GET /api/deck/profiles — creators-profiles.json (static file)
  app.get('/api/deck/profiles', async (_req, reply) => {
    try {
      const filePath = resolve(DATA_DIR, 'creators-profiles.json');
      if (existsSync(filePath)) {
        return JSON.parse(readFileSync(filePath, 'utf-8'));
      }
    } catch {}
    return reply.status(404).send({ error: 'Profiles data not found.' });
  });

  // GET /api/deck/holdings — creator-holdings.json (static file)
  app.get('/api/deck/holdings', async (_req, reply) => {
    try {
      const filePath = resolve(DATA_DIR, 'creator-holdings.json');
      if (existsSync(filePath)) {
        return JSON.parse(readFileSync(filePath, 'utf-8'));
      }
    } catch {}
    return reply.status(404).send({ error: 'Holdings data not found.' });
  });

  // GET /api/deck/missing?wallet=0x... — missing creators with priced bridge suggestions
  app.get<{ Querystring: { wallet?: string } }>('/api/deck/missing', async (req, reply) => {
    const wallet = req.query.wallet?.toLowerCase()?.trim();
    if (!wallet || !wallet.startsWith('0x')) {
      return reply.status(400).send({ error: 'Missing or invalid wallet parameter. Use ?wallet=0x...' });
    }

    const start = Date.now();

    // Load wallet detail
    const detail = loadDetail();
    const walletDetail = detail[wallet];
    if (!walletDetail) {
      return reply.status(404).send({
        error: 'Wallet not found in deck scores. It may not hold any creator cards.',
        wallet,
      });
    }

    // Load reference data
    const creatorHoldings = loadCreatorHoldings();
    const allCreators = loadAllCreators();
    const cache = getCache();

    // Timestamps for data freshness
    const holdersAsOf = getLastRefreshTime()?.toISOString() ?? null;
    const pricesAsOf = cache.lastUpdated?.toISOString() ?? null;

    // Compute missing with bestPicks + remaining split
    const response = computeMissingForAPI(
      walletDetail,
      creatorHoldings,
      allCreators,
      cache.data,
      holdersAsOf,
      pricesAsOf,
      wallet,
    );

    const elapsed = Date.now() - start;
    log.info({ wallet, missingCount: response.missingCount, bestPicks: response.bestPicks.length, remaining: response.remaining.length, elapsedMs: elapsed }, 'Missing creators API response');

    return response;
  });
}
