/**
 * deck-missing.ts — Compute missing creators and smart bridge suggestions for a wallet.
 *
 * Given a wallet's reach data, determines which creators are unreachable and
 * suggests the best XCC cards to buy using a greedy set-cover algorithm.
 */

import { childLogger } from '../lib/logger.js';
import { getTokenIds, type Rarity } from './token-map.js';

const log = childLogger('deck-missing');

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DirectHolding {
  creator: string;
  rarity: string;
  quantity: number;
}

export interface WalletDetail {
  direct: DirectHolding[];
  secondary: Record<string, string[]>; // creator -> bridging XCC handles
}

export interface CreatorHoldingsMap {
  [xccHandle: string]: {
    wallet: string;
    holds: Array<{ creator: string; rarity: string; quantity: number }>;
  };
}

export interface MissingCreator {
  handle: string;
  displayName: string;
  bridges: Array<{
    xccHandle: string;
    xccDisplayName: string;
    otherMissingCovered: number;
  }>;
}

export interface BridgeSuggestion {
  xccHandle: string;
  xccDisplayName: string;
  missingCreatorsCovered: string[];
  coverageCount: number;
}

export interface MissingResult {
  missingCount: number;
  totalCreators: number;
  missing: MissingCreator[];
  topBridges: BridgeSuggestion[];
  greedySetCover: BridgeSuggestion[];
  cardsToFull: number;
}

export interface BridgeSuggestionWithPrice extends BridgeSuggestion {
  cheapestRarity: string;
  xeetFloor: number | null;
  osFloor: number | null;
  usdEstimate: number | null;
  valueScore: number; // coverageCount / min(floors) — higher = better value per cost
}

// ─── Core computation ───────────────────────────────────────────────────────

export function computeMissing(
  walletDetail: WalletDetail,
  creatorHoldings: CreatorHoldingsMap,
  allCreators: Array<{ handle: string; displayName: string }>,
  cacheData?: Map<string, { xeetFloor: number | null; osFloor: number | null }>,
): MissingResult {
  const start = Date.now();

  // Build display name lookup
  const displayNames = new Map<string, string>();
  for (const c of allCreators) {
    displayNames.set(c.handle.toLowerCase(), c.displayName);
  }

  // All creator handles (lowercased)
  const allHandles = new Set(allCreators.map(c => c.handle.toLowerCase()));

  // Reached set: direct holdings + secondary reach
  const reachedSet = new Set<string>();
  for (const h of walletDetail.direct) {
    reachedSet.add(h.creator.toLowerCase());
  }
  for (const secCreator of Object.keys(walletDetail.secondary)) {
    reachedSet.add(secCreator.toLowerCase());
  }

  // Missing set
  const missingSet = new Set<string>();
  for (const h of allHandles) {
    if (!reachedSet.has(h)) missingSet.add(h);
  }

  // Direct holdings set (XCCs the wallet holds)
  const directHeldSet = new Set<string>();
  for (const h of walletDetail.direct) {
    directHeldSet.add(h.creator.toLowerCase());
  }

  // For each XCC NOT held by this wallet, compute which missing creators they bridge to
  const xccCoverage = new Map<string, Set<string>>(); // xccHandle -> set of missing creators they cover

  for (const [xccHandle, xccData] of Object.entries(creatorHoldings)) {
    const lc = xccHandle.toLowerCase();
    // Skip XCCs the wallet already holds (already contributing to reach)
    if (directHeldSet.has(lc)) continue;

    const covers = new Set<string>();
    for (const holding of xccData.holds) {
      const creatorLc = holding.creator.toLowerCase();
      if (missingSet.has(creatorLc) && creatorLc !== lc) {
        covers.add(creatorLc);
      }
    }
    if (covers.size > 0) {
      xccCoverage.set(lc, covers);
    }
  }

  // Build MissingCreator list with bridge info
  const missing: MissingCreator[] = [];
  for (const handle of missingSet) {
    const bridges: MissingCreator['bridges'] = [];
    for (const [xccHandle, covers] of xccCoverage) {
      if (covers.has(handle) && xccHandle !== handle) {
        bridges.push({
          xccHandle,
          xccDisplayName: displayNames.get(xccHandle) || xccHandle,
          otherMissingCovered: covers.size - 1, // how many OTHER missing this XCC covers
        });
      }
    }
    // Sort bridges by coverage (most helpful XCC first)
    bridges.sort((a, b) => b.otherMissingCovered - a.otherMissingCovered);

    missing.push({
      handle,
      displayName: displayNames.get(handle) || handle,
      bridges,
    });
  }

  // Top 10 bridges by raw coverage count
  const topBridges: BridgeSuggestion[] = Array.from(xccCoverage.entries())
    .map(([xccHandle, covers]) => ({
      xccHandle,
      xccDisplayName: displayNames.get(xccHandle) || xccHandle,
      missingCreatorsCovered: Array.from(covers),
      coverageCount: covers.size,
    }))
    .sort((a, b) => b.coverageCount - a.coverageCount)
    .slice(0, 10);

  // Greedy set-cover: minimum cards to reach 100%
  const greedySetCover: BridgeSuggestion[] = [];
  const remaining = new Set(missingSet);

  // Work with copies of coverage sets
  const coverageCopy = new Map<string, Set<string>>();
  for (const [k, v] of xccCoverage) {
    coverageCopy.set(k, new Set(v));
  }

  // Build case-insensitive index for cache lookups (cache keys use original casing)
  const cacheLcIndex = new Map<string, string>();
  if (cacheData) {
    for (const key of cacheData.keys()) {
      cacheLcIndex.set(key.toLowerCase(), key);
    }
  }

  // Helper: get cheapest floor price for an XCC across rarities (for greedy tiebreaker)
  const getCheapestFloor = (handle: string): number => {
    if (!cacheData) return Infinity;
    let cheapest = Infinity;
    for (const rarity of ['common', 'rare', 'legendary']) {
      const originalKey = cacheLcIndex.get(`${handle.toLowerCase()}:${rarity}`);
      const entry = originalKey ? cacheData.get(originalKey) : undefined;
      if (entry?.osFloor != null && entry.osFloor > 0 && entry.osFloor < cheapest) {
        cheapest = entry.osFloor;
      }
    }
    return cheapest;
  };

  while (remaining.size > 0) {
    // Find XCC that covers the most remaining missing; on tie, prefer cheaper
    let bestHandle = '';
    let bestCount = 0;
    let bestFloor = Infinity;
    let bestCovers = new Set<string>();

    for (const [xccHandle, covers] of coverageCopy) {
      // Intersect with remaining
      let count = 0;
      const intersection = new Set<string>();
      for (const c of covers) {
        if (remaining.has(c)) {
          count++;
          intersection.add(c);
        }
      }
      if (count > bestCount) {
        // More coverage = always wins
        bestCount = count;
        bestHandle = xccHandle;
        bestCovers = intersection;
        bestFloor = getCheapestFloor(xccHandle);
      } else if (count === bestCount && count > 0) {
        // Same coverage = prefer cheaper floor price
        const floor = getCheapestFloor(xccHandle);
        if (floor < bestFloor) {
          bestHandle = xccHandle;
          bestCovers = intersection;
          bestFloor = floor;
        }
      }
    }

    if (bestCount === 0) break; // No XCC can cover any remaining — truly unreachable

    greedySetCover.push({
      xccHandle: bestHandle,
      xccDisplayName: displayNames.get(bestHandle) || bestHandle,
      missingCreatorsCovered: Array.from(bestCovers),
      coverageCount: bestCovers.size,
    });

    // Remove covered creators from remaining
    for (const c of bestCovers) {
      remaining.delete(c);
    }
    // Remove this XCC from candidates
    coverageCopy.delete(bestHandle);
  }

  const elapsed = Date.now() - start;
  log.info({ missingCount: missingSet.size, topBridges: topBridges.length, greedyCover: greedySetCover.length, remainingUnreachable: remaining.size, elapsedMs: elapsed }, 'computeMissing complete');

  return {
    missingCount: missingSet.size,
    totalCreators: allHandles.size,
    missing,
    topBridges,
    greedySetCover,
    cardsToFull: remaining.size > 0
      ? greedySetCover.length // + remaining.size for truly unreachable
      : greedySetCover.length,
  };
}

// ─── Price enrichment ────────────────────────────────────────────────────────

/**
 * Enrich bridge suggestions with floor prices from the pipeline cache.
 * For each bridge XCC, find the cheapest rarity available on either marketplace.
 */
export function enrichWithPrices(
  bridges: BridgeSuggestion[],
  cacheData: Map<string, { xeetFloor: number | null; osFloor: number | null; usdEstimate: number | null }>,
): BridgeSuggestionWithPrice[] {
  const rarities = ['common', 'rare', 'legendary'] as const;

  // Build case-insensitive lookup: cache keys use original case (e.g. "ProofOfEly:common")
  // but bridge handles are lowercase. Index once, reuse for all bridges.
  const lcIndex = new Map<string, string>(); // lowercase key → original key
  for (const key of cacheData.keys()) {
    lcIndex.set(key.toLowerCase(), key);
  }

  const lookupCache = (handle: string, rarity: string) => {
    const lcKey = `${handle.toLowerCase()}:${rarity}`;
    const originalKey = lcIndex.get(lcKey);
    return originalKey ? cacheData.get(originalKey) : undefined;
  };

  return bridges.map((bridge) => {
    let cheapestRarity = 'common';
    let bestXeetFloor: number | null = null;
    let bestOsFloor: number | null = null;
    let bestUsd: number | null = null;
    let cheapestXeetPrice = Infinity;
    let cheapestOsPrice = Infinity;
    let xeetRarity = '';
    let osRarity = '';

    // Find cheapest xeetFloor and cheapest osFloor independently across rarities
    for (const rarity of rarities) {
      const entry = lookupCache(bridge.xccHandle, rarity);
      if (!entry) continue;

      if (entry.xeetFloor != null && entry.xeetFloor > 0 && entry.xeetFloor < cheapestXeetPrice) {
        cheapestXeetPrice = entry.xeetFloor;
        xeetRarity = rarity;
      }
      if (entry.osFloor != null && entry.osFloor > 0 && entry.osFloor < cheapestOsPrice) {
        cheapestOsPrice = entry.osFloor;
        osRarity = rarity;
      }
    }

    // Set best prices — null if no listing exists on that marketplace
    bestXeetFloor = cheapestXeetPrice < Infinity ? cheapestXeetPrice : null;
    bestOsFloor = cheapestOsPrice < Infinity ? cheapestOsPrice : null;

    // cheapestRarity = whichever has a listing (prefer OS rarity since it has USD estimate)
    if (osRarity) {
      cheapestRarity = osRarity;
      const osEntry = cacheData.get(`${bridge.xccHandle.toLowerCase()}:${osRarity}`);
      bestUsd = osEntry?.usdEstimate ?? null;
    } else if (xeetRarity) {
      cheapestRarity = xeetRarity;
    }

    // Value score: coverage per OS ETH cost (since ETH is the more universal unit)
    let valueScore = 0;
    if (bestOsFloor != null && bestOsFloor > 0) {
      valueScore = (bridge.coverageCount * 100) / bestOsFloor;
    }

    return {
      ...bridge,
      cheapestRarity,
      xeetFloor: bestXeetFloor,
      osFloor: bestOsFloor,
      usdEstimate: bestUsd,
      valueScore: Math.round(valueScore * 100) / 100,
    };
  });
}

// ─── API-ready response ──────────────────────────────────────────────────────

export interface MissingAPIResponse {
  holdersAsOf: string | null;
  pricesAsOf: string | null;
  wallet: string;
  totalCreators: number;
  reachable: number;
  missingCount: number;

  bestPicks: Array<{
    xccHandle: string;
    xccDisplayName: string;
    xccAvatar: string;
    cheapestRarity: string;
    tokenId: string | null;
    xeetFloor: number | null;
    osFloor: number | null;
    usdEstimate: number | null;
    missingCreatorsCovered: Array<{
      handle: string;
      displayName: string;
      avatar: string;
    }>;
    coverageCount: number;
  }>;

  remaining: Array<{
    handle: string;
    displayName: string;
    avatar: string;
    unreachable: boolean;
    options: Array<{
      xccHandle: string;
      xccDisplayName: string;
      xccAvatar: string;
      cheapestRarity: string;
      tokenId: string | null;
      xeetFloor: number | null;
      osFloor: number | null;
      usdEstimate: number | null;
      otherMissingCovered: number;
    }>;
  }>;
}

function avatarUrl(handle: string): string {
  return `/avatars/${handle.toLowerCase()}.jpg`;
}

function getFirstTokenId(handle: string, rarity: string): string | null {
  const ids = getTokenIds(handle.toLowerCase(), rarity as Rarity);
  return ids.length > 0 ? ids[0] : null;
}

/**
 * Compute the split bestPicks + remaining response for the frontend.
 * bestPicks = top 3 greedy set cover cards (most coverage).
 * remaining = missing creators NOT fully covered by bestPicks.
 */
export function computeMissingForAPI(
  walletDetail: WalletDetail,
  creatorHoldings: CreatorHoldingsMap,
  allCreators: Array<{ handle: string; displayName: string }>,
  cacheData: Map<string, { xeetFloor: number | null; osFloor: number | null; usdEstimate: number | null }>,
  holdersAsOf: string | null,
  pricesAsOf: string | null,
  wallet: string,
): MissingAPIResponse {
  const result = computeMissing(walletDetail, creatorHoldings, allCreators, cacheData);

  // Display name lookup
  const displayNames = new Map<string, string>();
  for (const c of allCreators) {
    displayNames.set(c.handle.toLowerCase(), c.displayName);
  }
  const getName = (h: string) => displayNames.get(h.toLowerCase()) || h;

  // Top 3 greedy set cover = bestPicks, re-sorted by value (coverage per cost)
  const top3 = result.greedySetCover.slice(0, 3);
  const enrichedTop3 = enrichWithPrices(top3, cacheData);

  // Re-sort by value score: best value first, no-price cards last
  enrichedTop3.sort((a, b) => {
    const aHas = (a.xeetFloor != null && a.xeetFloor > 0) || (a.osFloor != null && a.osFloor > 0);
    const bHas = (b.xeetFloor != null && b.xeetFloor > 0) || (b.osFloor != null && b.osFloor > 0);
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (a.valueScore !== b.valueScore) return b.valueScore - a.valueScore;
    return (a.osFloor ?? Infinity) - (b.osFloor ?? Infinity);
  });

  // Collect all creators covered by top 3
  const coveredByBestPicks = new Set<string>();
  for (const pick of top3) {
    for (const c of pick.missingCreatorsCovered) {
      coveredByBestPicks.add(c.toLowerCase());
    }
  }

  // Build bestPicks with covered creator details
  const bestPicks = enrichedTop3.map((pick) => ({
    xccHandle: pick.xccHandle,
    xccDisplayName: pick.xccDisplayName,
    xccAvatar: avatarUrl(pick.xccHandle),
    cheapestRarity: pick.cheapestRarity,
    tokenId: getFirstTokenId(pick.xccHandle, pick.cheapestRarity),
    xeetFloor: pick.xeetFloor,
    osFloor: pick.osFloor,
    usdEstimate: pick.usdEstimate,
    missingCreatorsCovered: pick.missingCreatorsCovered.map((h) => ({
      handle: h,
      displayName: getName(h),
      avatar: avatarUrl(h),
    })),
    coverageCount: pick.coverageCount,
  }));

  // Remaining = missing creators NOT covered by top 3
  const remaining = result.missing
    .filter((m) => !coveredByBestPicks.has(m.handle.toLowerCase()))
    .map((m) => {
      const isUnreachable = m.bridges.length === 0;

      // For reachable ones, enrich top 5 bridge options with prices
      const options = isUnreachable
        ? []
        : m.bridges.slice(0, 5).map((b) => {
            // Find cheapest price for this bridge XCC
            const enriched = enrichWithPrices(
              [{ xccHandle: b.xccHandle, xccDisplayName: b.xccDisplayName, missingCreatorsCovered: [], coverageCount: b.otherMissingCovered + 1 }],
              cacheData,
            )[0];
            return {
              xccHandle: b.xccHandle,
              xccDisplayName: b.xccDisplayName,
              xccAvatar: avatarUrl(b.xccHandle),
              cheapestRarity: enriched.cheapestRarity,
              tokenId: getFirstTokenId(b.xccHandle, enriched.cheapestRarity),
              xeetFloor: enriched.xeetFloor,
              osFloor: enriched.osFloor,
              usdEstimate: enriched.usdEstimate,
              otherMissingCovered: b.otherMissingCovered,
            };
          });

      return {
        handle: m.handle,
        displayName: m.displayName,
        avatar: avatarUrl(m.handle),
        unreachable: isUnreachable,
        options,
      };
    });

  return {
    holdersAsOf,
    pricesAsOf,
    wallet,
    totalCreators: result.totalCreators,
    reachable: result.totalCreators - result.missingCount,
    missingCount: result.missingCount,
    bestPicks,
    remaining,
  };
}
