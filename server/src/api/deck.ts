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
import { getDb, getStmts } from '../db/index.js';
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
let cachedMultiWallet: Record<string, { primaryWallet: string; additionalWallets: Array<{ address: string }> }> | null = null;

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

function loadMultiWallet(): typeof cachedMultiWallet {
  if (cachedMultiWallet) return cachedMultiWallet;
  const mwPath = resolve(DATA_DIR, 'multi-wallet-creators.json');
  if (!existsSync(mwPath)) return {};
  cachedMultiWallet = JSON.parse(readFileSync(mwPath, 'utf-8'));
  return cachedMultiWallet!;
}

/** Get all wallet addresses associated with a given wallet (primary + alts) */
function getAllWalletsFor(wallet: string): string[] {
  const lc = wallet.toLowerCase();
  const mw = loadMultiWallet() || {};
  for (const entry of Object.values(mw)) {
    const primary = entry.primaryWallet.toLowerCase();
    const alts = entry.additionalWallets.map(a => a.address.toLowerCase());
    const allWallets = [primary, ...alts];
    if (allWallets.includes(lc)) {
      return allWallets;
    }
  }
  return [lc];
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

  // ─── GET /api/deck/valuation — deck value based on highest OS sales ────────

  app.get<{ Querystring: { wallet?: string } }>('/api/deck/valuation', async (req, reply) => {
    const wallet = req.query.wallet?.toLowerCase()?.trim();
    if (!wallet || !wallet.startsWith('0x')) {
      return reply.status(400).send({ error: 'Missing or invalid wallet parameter. Use ?wallet=0x...' });
    }

    const detail = loadDetail();
    const walletDetail = detail[wallet];
    if (!walletDetail) {
      return reply.status(404).send({ error: 'Wallet not found in deck scores.', wallet });
    }

    const stmts = getStmts();
    const cache = getCache();
    const ethUsdRate = cache.ethUsdRate || 0;

    interface ValuationCard {
      creator: string;
      displayName: string;
      rarity: string;
      quantity: number;
      purchasePriceEth: number | null;
      purchasePriceXeets: number | null;
      highestSaleEth: number | null;
      medianSaleEth: number | null;
      avgSaleEth: number | null;
      saleCount: number;
      currentFloorEth: number | null;
      source: 'sale' | 'floor' | 'no_data';
    }

    const cards: ValuationCard[] = [];
    let totalHighest = 0;
    let totalMedian = 0;
    let totalAvg = 0;
    let totalCostBasis = 0;
    let cardsWithValue = 0;
    let cardsWithCost = 0;
    let cardsNoData = 0;

    const allCreators = loadAllCreators();
    const displayNames = new Map<string, string>();
    for (const c of allCreators) {
      displayNames.set(c.handle.toLowerCase(), c.displayName);
    }

    // Build case-insensitive cache lookup
    const cacheLcIndex = new Map<string, string>();
    for (const key of cache.data.keys()) {
      cacheLcIndex.set(key.toLowerCase(), key);
    }

    // Query all purchases for this wallet + any alt wallets (multi-wallet creators)
    const allWallets = getAllWalletsFor(wallet);
    const purchaseRows: Array<{
      creator_handle: string;
      rarity: string;
      price: number;
      currency: string;
      marketplace: string;
    }> = [];
    for (const w of allWallets) {
      const rows = stmts.getPurchasesByWallet.all(w) as typeof purchaseRows;
      purchaseRows.push(...rows);
    }
    // Sort by date desc (most recent first) — getPurchasesByWallet already sorts DESC per wallet
    // Build purchase lookup: creator:rarity → { ethPrice, xeetsPrice }
    // If multiple purchases for same creator:rarity, use the most recent
    const purchaseMap = new Map<string, { eth: number | null; xeets: number | null }>();
    for (const p of purchaseRows) {
      const key = `${p.creator_handle.toLowerCase()}:${p.rarity}`;
      if (!purchaseMap.has(key)) {
        purchaseMap.set(key, { eth: null, xeets: null });
      }
      const entry = purchaseMap.get(key)!;
      if ((p.currency === 'ETH' || p.currency === 'WETH') && entry.eth === null) {
        entry.eth = p.price;
      }
      if (p.currency === 'XEETS' && entry.xeets === null) {
        entry.xeets = p.price;
      }
    }

    // Batch-fetch all OS sale prices for median computation
    // Group by creator:rarity → sorted price array
    const db = getDb();
    const allOsSales = db.prepare(`
      SELECT creator_handle, rarity, price
      FROM sale_history
      WHERE marketplace = 'opensea' AND currency IN ('ETH', 'WETH')
      ORDER BY creator_handle, rarity, price
    `).all() as Array<{ creator_handle: string; rarity: string; price: number }>;

    const salePrices = new Map<string, number[]>();
    for (const s of allOsSales) {
      const key = `${s.creator_handle.toLowerCase()}:${s.rarity}`;
      if (!salePrices.has(key)) salePrices.set(key, []);
      salePrices.get(key)!.push(s.price);
    }

    function median(arr: number[]): number | null {
      if (arr.length === 0) return null;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    for (const holding of walletDetail.direct) {
      const creator = holding.creator.toLowerCase();
      const rarity = holding.rarity;
      const quantity = holding.quantity || 1;

      // Purchase price for this card
      const purchase = purchaseMap.get(`${creator}:${rarity}`);
      const purchasePriceEth = purchase?.eth ?? null;
      const purchasePriceXeets = purchase?.xeets ?? null;

      // Sale data from pre-fetched prices
      const key = `${creator}:${rarity}`;
      const prices = salePrices.get(key) || [];
      const highestSaleEth = prices.length > 0 ? Math.max(...prices) : null;
      const medianSaleEth = median(prices);
      const avgSaleEth = prices.length > 0
        ? Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100000) / 100000
        : null;
      const saleCount = prices.length;

      // Current OS floor from pipeline cache
      let currentFloorEth: number | null = null;
      const originalKey = cacheLcIndex.get(key);
      if (originalKey) {
        const entry = cache.data.get(originalKey);
        if (entry?.osFloor != null && entry.osFloor > 0) {
          currentFloorEth = entry.osFloor;
        }
      }

      // Determine source: use sale data if available, then floor, then no_data
      let source: ValuationCard['source'] = 'no_data';
      let valueForHighest: number | null = null;
      let valueForMedian: number | null = null;
      let valueForAvg: number | null = null;
      if (highestSaleEth != null) {
        source = 'sale';
        valueForHighest = highestSaleEth;
        valueForMedian = medianSaleEth;
        valueForAvg = avgSaleEth;
      } else if (currentFloorEth != null) {
        source = 'floor';
        valueForHighest = currentFloorEth;
        valueForMedian = currentFloorEth;
        valueForAvg = currentFloorEth;
      }

      if (valueForHighest != null) {
        cardsWithValue += quantity;
        totalHighest += valueForHighest * quantity;
        totalMedian += (valueForMedian ?? valueForHighest) * quantity;
        totalAvg += (valueForAvg ?? valueForHighest) * quantity;
      } else {
        cardsNoData += quantity;
      }

      // Cost basis (ETH only)
      if (purchasePriceEth != null) {
        totalCostBasis += purchasePriceEth * quantity;
        cardsWithCost += quantity;
      }

      cards.push({
        creator,
        displayName: displayNames.get(creator) || creator,
        rarity,
        quantity,
        purchasePriceEth,
        purchasePriceXeets,
        highestSaleEth,
        medianSaleEth,
        avgSaleEth,
        saleCount,
        currentFloorEth,
        source,
      });
    }

    return {
      wallet,
      valuation: {
        highest: {
          totalEth: Math.round(totalHighest * 10000) / 10000,
          totalUsd: ethUsdRate > 0 ? Math.round(totalHighest * ethUsdRate * 100) / 100 : null,
          label: 'Based on highest OS sale per card',
        },
        median: {
          totalEth: Math.round(totalMedian * 10000) / 10000,
          totalUsd: ethUsdRate > 0 ? Math.round(totalMedian * ethUsdRate * 100) / 100 : null,
          label: 'Based on median OS sale per card',
        },
        average: {
          totalEth: Math.round(totalAvg * 10000) / 10000,
          totalUsd: ethUsdRate > 0 ? Math.round(totalAvg * ethUsdRate * 100) / 100 : null,
          label: 'Based on average OS sale per card',
        },
      },
      costBasis: {
        totalEth: Math.round(totalCostBasis * 10000) / 10000,
        totalUsd: ethUsdRate > 0 ? Math.round(totalCostBasis * ethUsdRate * 100) / 100 : null,
        cardsWithCost,
        label: 'Based on your OS purchase prices',
      },
      ethUsdRate,
      totalCards: cards.reduce((s, c) => s + c.quantity, 0),
      cardsWithValue,
      cardsNoData,
      cards,
    };
  });

  // ─── GET /api/deck/upgrades — rarity upgrade opportunities ─────────────────

  app.get<{ Querystring: { wallet?: string } }>('/api/deck/upgrades', async (req, reply) => {
    const wallet = req.query.wallet?.toLowerCase()?.trim();
    if (!wallet || !wallet.startsWith('0x')) {
      return reply.status(400).send({ error: 'Missing or invalid wallet parameter. Use ?wallet=0x...' });
    }

    const detail = loadDetail();
    const walletDetail = detail[wallet];
    if (!walletDetail) {
      return reply.status(404).send({ error: 'Wallet not found in deck scores.', wallet });
    }

    const cache = getCache();
    const ethUsdRate = cache.ethUsdRate || 0;
    const RARITY_UPGRADE: Record<string, string> = { common: 'rare', rare: 'legendary' };

    const allCreators = loadAllCreators();
    const displayNames = new Map<string, string>();
    for (const c of allCreators) {
      displayNames.set(c.handle.toLowerCase(), c.displayName);
    }

    // Case-insensitive cache lookup helper
    const lookupFloor = (handle: string, rarity: string): number | null => {
      const target = `${handle.toLowerCase()}:${rarity}`;
      for (const key of cache.data.keys()) {
        if (key.toLowerCase() === target) {
          const entry = cache.data.get(key);
          return entry?.osFloor ?? null;
        }
      }
      return null;
    };

    interface UpgradeOpportunity {
      creator: string;
      displayName: string;
      currentRarity: string;
      upgradeRarity: string;
      currentFloorEth: number;
      upgradeFloorEth: number;
      currentFloorUsd: number | null;
      upgradeFloorUsd: number | null;
      ratio: number;
      tier: 'strong_upgrade' | 'decent_upgrade' | 'consider';
    }

    const opportunities: UpgradeOpportunity[] = [];

    for (const holding of walletDetail.direct) {
      const creator = holding.creator.toLowerCase();
      const rarity = holding.rarity;
      const nextRarity = RARITY_UPGRADE[rarity];
      if (!nextRarity) continue; // legendary has no upgrade

      const currentFloor = lookupFloor(creator, rarity);
      const upgradeFloor = lookupFloor(creator, nextRarity);

      if (!currentFloor || currentFloor <= 0 || !upgradeFloor || upgradeFloor <= 0) continue;

      const ratio = upgradeFloor / currentFloor;
      if (ratio > 5) continue; // >5x = too expensive, exclude

      let tier: UpgradeOpportunity['tier'];
      if (ratio < 2) tier = 'strong_upgrade';
      else if (ratio < 3) tier = 'decent_upgrade';
      else tier = 'consider';

      opportunities.push({
        creator,
        displayName: displayNames.get(creator) || creator,
        currentRarity: rarity,
        upgradeRarity: nextRarity,
        currentFloorEth: currentFloor,
        upgradeFloorEth: upgradeFloor,
        currentFloorUsd: ethUsdRate > 0 ? Math.round(currentFloor * ethUsdRate * 100) / 100 : null,
        upgradeFloorUsd: ethUsdRate > 0 ? Math.round(upgradeFloor * ethUsdRate * 100) / 100 : null,
        ratio: Math.round(ratio * 100) / 100,
        tier,
      });
    }

    // Sort by ratio ascending (best deals first)
    opportunities.sort((a, b) => a.ratio - b.ratio);

    return {
      wallet,
      ethUsdRate,
      totalOpportunities: opportunities.length,
      opportunities,
    };
  });
}
