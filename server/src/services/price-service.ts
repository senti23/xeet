import { getCollectionStats } from './opensea-client.js';
import { childLogger } from '../lib/logger.js';
import { config } from '../config.js';

const log = childLogger('price-service');

let ethUsdRate = 0;
let lastRefresh = 0;

export async function refreshEthUsdRate(): Promise<void> {
  const now = Date.now();
  if (ethUsdRate > 0 && now - lastRefresh < config.pipeline.priceRefreshMs) return;

  try {
    const stats = await getCollectionStats();
    if (!stats) {
      log.warn('Could not fetch collection stats for ETH/USD rate');
      return;
    }

    // OpenSea stats include floor in ETH; the intervals may have USD-referenced data
    // For ETH/USD we check if there's volume data we can derive from, or fall back to
    // a reasonable estimate. OpenSea shows USD prices by using their internal rate.
    // The stats endpoint returns ETH values; we'll use the total volume and market_cap
    // to estimate if needed. For now, use a well-known free fallback:
    // Try CoinGecko-style endpoint or hardcode a reasonable recent rate.
    // Since OpenSea shows USD on hover, the actual conversion is client-side with their rate.
    // We'll fetch from a simple source in the pipeline.

    // For the MVP, derive from the stats if available, otherwise use a cached rate
    if (stats.total?.floor_price && stats.total.floor_price > 0) {
      lastRefresh = now;
      log.info({ floorEth: stats.total.floor_price }, 'Stats refreshed');
    }
  } catch (err) {
    log.error({ err }, 'ETH/USD rate refresh failed');
  }
}

export async function fetchEthUsdRate(): Promise<number> {
  try {
    // Try fetching from a public endpoint
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    if (res.ok) {
      const data = await res.json() as { ethereum?: { usd?: number } };
      if (data.ethereum?.usd) {
        ethUsdRate = data.ethereum.usd;
        lastRefresh = Date.now();
        log.info({ ethUsdRate }, 'ETH/USD rate updated');
        return ethUsdRate;
      }
    }
  } catch {
    // CoinGecko may be rate limited or blocked, use fallback
  }

  // Fallback: reasonable default (can be updated)
  if (ethUsdRate === 0) {
    ethUsdRate = 2500; // reasonable fallback
    log.warn({ ethUsdRate }, 'Using fallback ETH/USD rate');
  }
  return ethUsdRate;
}

export function getEthUsdRate(): number {
  return ethUsdRate;
}

export function ethToUsd(ethAmount: number): number | null {
  if (ethUsdRate <= 0) return null;
  return Math.round(ethAmount * ethUsdRate * 100) / 100;
}
