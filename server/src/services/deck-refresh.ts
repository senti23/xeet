/**
 * deck-refresh.ts — Unified 10-minute refresh: holders → scores → floor prices.
 *
 * Single coordinated job that keeps all deck data in sync.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { childLogger } from '../lib/logger.js';
import { getStmts } from '../db/index.js';
import { refreshHolders } from './holder-service.js';
import { getCache } from './data-pipeline.js';
import {
  computeAllDeckScores,
  type Creator,
  type HoldingEntry,
  type CreatorHolding,
  type MultiWalletEntry,
} from '../../scripts/compute-deck-scores.js';

import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = childLogger('deck-refresh');

// In dev: write JSON to web/public/data/. In prod: serve from memory via API.
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const WEB_PUBLIC_DATA = resolve(__dirname, '..', '..', '..', 'web', 'public', 'data');
const DATA_DIR = config.dataDir;

// Log resolved paths on startup for Railway debugging
log.info({
  dataDir: DATA_DIR,
  webPublicData: IS_PRODUCTION ? '(skipped in production)' : WEB_PUBLIC_DATA,
  isProduction: IS_PRODUCTION,
}, 'Deck refresh paths resolved');

// ─── State ──────────────────────────────────────────────────────────────────

let lastRefreshTime: Date | null = null;
let lastDuration = 0;
let lastHolderCount = 0;
let lastScoreCount = 0;
let refreshRunning = false;

// ─── In-memory cache for production (served via API) ────────────────────────
let cachedDeckScores: object | null = null;
let cachedDeckDetail: object | null = null;
let cachedFloorPrices: object | null = null;

export function getCachedDeckScores() { return cachedDeckScores; }
export function getCachedDeckDetail() { return cachedDeckDetail; }
export function getCachedFloorPrices() { return cachedFloorPrices; }

const RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

export interface RefreshResult {
  holdersUpdated: boolean;
  holderRows: number;
  scoresComputed: number;
  floorPricesExported: boolean;
  duration: number;
}

export interface RefreshStatus {
  lastRefresh: string | null;
  nextRefresh: string | null;
  holderCount: number;
  scoreCount: number;
  lastDuration: number;
  running: boolean;
}

// ─── Floor price export ─────────────────────────────────────────────────────

function exportFloorPrices(outputDir: string | null): { creatorsWithFloor: number; data: object } {
  const cache = getCache();
  const floors: Record<string, Record<string, {
    xeetFloor: number | null;
    osFloor: number | null;
    usdEstimate: number | null;
    xeetListings: number;
    osListings: number;
    lastSalePrice: number | null;
    lastSaleMarketplace: string | null;
    lastSaleDate: string | null;
    bestOffer: number | null;
  } | null>> = {};

  const creatorsWithFloor = new Set<string>();

  for (const [k, data] of cache.data) {
    const [creator, rarity] = k.split(':');
    if (!floors[creator]) floors[creator] = { common: null, rare: null, legendary: null };

    const xeetDate = data.lastSaleXeetDate ? new Date(data.lastSaleXeetDate).getTime() : 0;
    const osDate = data.lastSaleOsDate ? new Date(data.lastSaleOsDate).getTime() : 0;
    const lastIsXeet = xeetDate >= osDate && data.lastSaleXeet != null;

    floors[creator][rarity] = {
      xeetFloor: data.xeetFloor,
      osFloor: data.osFloor,
      usdEstimate: data.usdEstimate,
      xeetListings: data.xeetListingCount,
      osListings: data.osListingCount,
      lastSalePrice: lastIsXeet ? data.lastSaleXeet : (data.lastSaleOs ?? data.lastSaleXeet),
      lastSaleMarketplace: lastIsXeet ? 'xeet' : (data.lastSaleOs != null ? 'opensea' : (data.lastSaleXeet != null ? 'xeet' : null)),
      lastSaleDate: lastIsXeet ? data.lastSaleXeetDate : (data.lastSaleOsDate ?? data.lastSaleXeetDate),
      bestOffer: data.bestOffer,
    };
    if (data.xeetFloor !== null || data.osFloor !== null) {
      creatorsWithFloor.add(creator);
    }
  }

  const result = {
    generated: new Date().toISOString(),
    ethUsdRate: cache.ethUsdRate,
    prices: floors,
  };

  // Write to disk only in dev
  if (outputDir) {
    writeFileSync(resolve(outputDir, 'floor-prices.json'), JSON.stringify(result));
  }

  return { creatorsWithFloor: creatorsWithFloor.size, data: result };
}

// ─── Main refresh function ──────────────────────────────────────────────────

export async function refreshDeckData(): Promise<RefreshResult> {
  if (refreshRunning) {
    log.warn('Refresh already running, skipping');
    return { holdersUpdated: false, holderRows: 0, scoresComputed: 0, floorPricesExported: false, duration: 0 };
  }

  refreshRunning = true;
  const start = Date.now();

  try {
    // Ensure output directory exists
    if (!existsSync(WEB_PUBLIC_DATA)) {
      mkdirSync(WEB_PUBLIC_DATA, { recursive: true });
    }

    // Verify path resolves correctly
    log.info({ outputDir: WEB_PUBLIC_DATA }, 'Refresh starting');

    // Step 1: Incremental holder refresh
    const holderStart = Date.now();
    try {
      await refreshHolders();
      log.info({ elapsedMs: Date.now() - holderStart }, 'Step 1: Holder refresh complete');
    } catch (err) {
      log.error({ err }, 'Holder refresh failed, continuing with existing data');
    }

    // Step 2: Query all holders from DB
    const queryStart = Date.now();
    const stmts = getStmts();
    const rows = stmts.getAllHolders.all() as Array<{
      wallet_address: string;
      token_id: string;
      quantity: number;
      creator_handle: string;
      rarity: string;
    }>;

    log.info({ rowCount: rows.length, elapsedMs: Date.now() - queryStart }, 'Step 2: getAllHolders query complete');

    // Group by wallet -> holderSnapshot format
    const holderSnapshot: Record<string, HoldingEntry[]> = {};
    for (const row of rows) {
      const addr = row.wallet_address.toLowerCase();
      if (!holderSnapshot[addr]) holderSnapshot[addr] = [];
      holderSnapshot[addr].push({
        creator: row.creator_handle,
        rarity: row.rarity,
        token_id: row.token_id,
        quantity: row.quantity,
      });
    }

    const walletCount = Object.keys(holderSnapshot).length;
    log.info({ walletCount }, 'Step 2: Grouped holders into wallets');

    // Step 3: Load static data files (creators, XCC holdings, multi-wallet)
    const loadStart = Date.now();
    const creatorsData: Creator[] = JSON.parse(
      readFileSync(resolve(DATA_DIR, 'xeet-creators-full.json'), 'utf-8'),
    );
    const creatorHoldings: Record<string, CreatorHolding> = JSON.parse(
      readFileSync(resolve(DATA_DIR, 'creator-holdings.json'), 'utf-8'),
    );
    const multiWalletData: Record<string, MultiWalletEntry> = JSON.parse(
      readFileSync(resolve(DATA_DIR, 'multi-wallet-creators.json'), 'utf-8'),
    );
    log.info({ elapsedMs: Date.now() - loadStart }, 'Step 3: Static data loaded');

    // Step 4: Compute deck scores
    const scoreStart = Date.now();
    const result = computeAllDeckScores(holderSnapshot, creatorHoldings, creatorsData, multiWalletData);
    log.info({
      walletsScored: result.totalWallets,
      totalCreators: result.totalCreators,
      elapsedMs: Date.now() - scoreStart,
    }, 'Step 4: Score computation complete');

    // Step 5: Cache scores in memory (always) + write to disk (dev only)
    const writeStart = Date.now();
    const deckScores = {
      generated: new Date().toISOString(),
      totalWallets: result.totalWallets,
      totalCreators: result.totalCreators,
      wallets: result.walletsSummary,
      leaderboard: result.leaderboard,
    };

    // Always cache in memory for API serving
    cachedDeckScores = deckScores;
    cachedDeckDetail = result.walletsDetail;

    // Write to disk only in development (web/public/data/ doesn't exist on Railway)
    if (!IS_PRODUCTION) {
      if (!existsSync(WEB_PUBLIC_DATA)) mkdirSync(WEB_PUBLIC_DATA, { recursive: true });
      writeFileSync(resolve(WEB_PUBLIC_DATA, 'deck-scores.json'), JSON.stringify(deckScores, null, 2));
      writeFileSync(resolve(WEB_PUBLIC_DATA, 'deck-scores-detail.json'), JSON.stringify(result.walletsDetail));

      const profilesPath = resolve(DATA_DIR, 'creators-profiles.json');
      if (existsSync(profilesPath)) {
        writeFileSync(resolve(WEB_PUBLIC_DATA, 'creators-profiles.json'), readFileSync(profilesPath));
      }
    }

    log.info({ elapsedMs: Date.now() - writeStart, writtenToDisk: !IS_PRODUCTION }, 'Step 5: Score files cached');

    // Step 6: Export floor prices (memory + disk in dev)
    const floorStart = Date.now();
    const floorResult = exportFloorPrices(IS_PRODUCTION ? null : WEB_PUBLIC_DATA);
    cachedFloorPrices = floorResult.data;
    log.info({
      creatorsWithFloor: floorResult.creatorsWithFloor,
      elapsedMs: Date.now() - floorStart,
    }, 'Step 6: Floor prices exported');

    // Update state
    const duration = Date.now() - start;
    lastRefreshTime = new Date();
    lastDuration = duration;
    lastHolderCount = walletCount;
    lastScoreCount = result.totalWallets;

    log.info({
      totalDurationMs: duration,
      wallets: walletCount,
      scores: result.totalWallets,
      floorCreators: floorResult.creatorsWithFloor,
    }, 'Deck refresh complete');

    return {
      holdersUpdated: true,
      holderRows: rows.length,
      scoresComputed: result.totalWallets,
      floorPricesExported: true,
      duration,
    };
  } catch (err) {
    log.error({ err }, 'Deck refresh failed');
    throw err;
  } finally {
    refreshRunning = false;
  }
}

// ─── Manual trigger with rate limiting ──────────────────────────────────────

export async function triggerManualRefresh(): Promise<RefreshResult | { error: string; retryAfterMs: number }> {
  if (lastRefreshTime && Date.now() - lastRefreshTime.getTime() < RATE_LIMIT_MS) {
    const retryAfterMs = RATE_LIMIT_MS - (Date.now() - lastRefreshTime.getTime());
    return { error: 'Rate limited', retryAfterMs };
  }
  return refreshDeckData();
}

// ─── Status ─────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export function getRefreshStatus(): RefreshStatus {
  const nextRefresh = lastRefreshTime
    ? new Date(lastRefreshTime.getTime() + REFRESH_INTERVAL_MS).toISOString()
    : null;

  return {
    lastRefresh: lastRefreshTime?.toISOString() ?? null,
    nextRefresh,
    holderCount: lastHolderCount,
    scoreCount: lastScoreCount,
    lastDuration,
    running: refreshRunning,
  };
}

export function getLastRefreshTime(): Date | null {
  return lastRefreshTime;
}
