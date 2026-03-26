/**
 * Compute Deck Reach Scores for all wallets in holder-snapshot.json
 *
 * Reach = how many of the 391 creators a wallet can access:
 *   - Direct: creators whose cards you hold
 *   - Secondary: creators reachable through XCCs you hold (their holdings)
 *   - Score = totalReach / totalCreators * 100
 *
 * Usage:
 *   npx tsx scripts/compute-deck-scores.ts
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const WEB_PUBLIC_DATA = resolve(REPO_ROOT, 'web/public/data');

// ─── Exported types ─────────────────────────────────────────────────────────

export interface Creator {
  xHandle: string;
  displayName: string;
  walletAddress: string;
  [key: string]: any;
}

export interface HoldingEntry {
  creator: string;
  rarity: string;
  token_id?: string;
  quantity: number;
}

export interface CreatorHolding {
  wallet: string;
  holds: HoldingEntry[];
}

export interface MultiWalletEntry {
  primaryWallet: string;
  additionalWallets: Array<{
    address: string;
    source: string;
    cards: number;
    uniqueCreators: number;
    holdings: HoldingEntry[];
  }>;
}

export interface WalletScoreSummary {
  isXCC: boolean;
  xHandle: string | null;
  displayName: string | null;
  directCount: number;
  secondaryCount: number;
  totalReach: number;
  score: number;
  rankXCC: number | null;
  rankAll: number;
}

export interface DirectHolding {
  creator: string;
  rarity: string;
  quantity: number;
}

export interface WalletScoreDetail {
  direct: DirectHolding[];
  secondary: Record<string, string[]>;
}

export interface LeaderboardEntry {
  wallet: string;
  handle: string | null;
  displayName: string | null;
  score: number;
  direct: number;
  reach: number;
}

export interface ScoredWallet {
  wallet: string;
  summary: WalletScoreSummary;
  detail: WalletScoreDetail;
}

export interface DeckScoreResult {
  walletsSummary: Record<string, WalletScoreSummary>;
  walletsDetail: Record<string, WalletScoreDetail>;
  leaderboard: {
    xcc: LeaderboardEntry[];
    all: LeaderboardEntry[];
  };
  totalWallets: number;
  totalCreators: number;
}

// ─── Pure scoring function (no side effects) ────────────────────────────────

export function computeAllDeckScores(
  holderSnapshot: Record<string, HoldingEntry[]>,
  creatorHoldings: Record<string, CreatorHolding>,
  creatorsData: Creator[],
  multiWalletData: Record<string, MultiWalletEntry>,
): DeckScoreResult {
  const TOTAL_CREATORS = creatorsData.length;

  // Build lookups
  const walletToCreator = new Map<string, { xHandle: string; displayName: string }>();
  const handleToWallet = new Map<string, string>();

  for (const c of creatorsData) {
    const addr = c.walletAddress.toLowerCase();
    const handle = c.xHandle.toLowerCase();
    walletToCreator.set(addr, { xHandle: c.xHandle, displayName: c.displayName });
    handleToWallet.set(handle, addr);
  }

  // XCC handle -> set of creator handles they hold
  const xccHoldsCreators = new Map<string, Set<string>>();
  for (const [handle, data] of Object.entries(creatorHoldings)) {
    const held = new Set<string>();
    for (const h of data.holds) {
      held.add(h.creator.toLowerCase());
    }
    xccHoldsCreators.set(handle.toLowerCase(), held);
  }

  // Merge multi-wallet holdings (mutates snapshot copy)
  const snapshot = { ...holderSnapshot };
  const additionalWalletsToRemove = new Set<string>();

  for (const [, mw] of Object.entries(multiWalletData)) {
    const primaryAddr = mw.primaryWallet.toLowerCase();
    if (!snapshot[primaryAddr]) continue;

    for (const alt of mw.additionalWallets) {
      const altAddr = alt.address.toLowerCase();
      additionalWalletsToRemove.add(altAddr);

      if (alt.holdings && alt.holdings.length > 0) {
        snapshot[primaryAddr] = [...snapshot[primaryAddr], ...alt.holdings];
      } else if (snapshot[altAddr]) {
        snapshot[primaryAddr] = [...snapshot[primaryAddr], ...snapshot[altAddr]];
      }
    }
  }

  for (const addr of additionalWalletsToRemove) {
    delete snapshot[addr];
  }

  // Score all wallets
  const RARITY_RANK: Record<string, number> = { legendary: 3, rare: 2, common: 1 };
  const scored: ScoredWallet[] = [];

  for (const [wallet, holdings] of Object.entries(snapshot)) {
    const addr = wallet.toLowerCase();

    // Direct holdings
    const directCreators = new Set<string>();
    const directMap = new Map<string, { rarity: string; quantity: number }>();
    for (const h of holdings) {
      const handle = h.creator.toLowerCase();
      directCreators.add(handle);
      const existing = directMap.get(handle);
      if (!existing) {
        directMap.set(handle, { rarity: h.rarity || 'common', quantity: h.quantity || 1 });
      } else {
        existing.quantity += h.quantity || 1;
        const newRank = RARITY_RANK[h.rarity] || 0;
        const oldRank = RARITY_RANK[existing.rarity] || 0;
        if (newRank > oldRank) existing.rarity = h.rarity;
      }
    }

    // Secondary reach
    const secondaryMap: Record<string, string[]> = {};
    for (const directHandle of directCreators) {
      const xccHolds = xccHoldsCreators.get(directHandle);
      if (!xccHolds) continue;
      for (const reachedCreator of xccHolds) {
        if (directCreators.has(reachedCreator)) continue;
        if (!secondaryMap[reachedCreator]) secondaryMap[reachedCreator] = [];
        secondaryMap[reachedCreator].push(directHandle);
      }
    }

    const secondaryCount = Object.keys(secondaryMap).length;
    const totalReach = directCreators.size + secondaryCount;
    const score = Math.round((totalReach / TOTAL_CREATORS) * 1000) / 10;

    const creatorInfo = walletToCreator.get(addr);

    scored.push({
      wallet: addr,
      summary: {
        isXCC: !!creatorInfo,
        xHandle: creatorInfo?.xHandle ?? null,
        displayName: creatorInfo?.displayName ?? null,
        directCount: directCreators.size,
        secondaryCount,
        totalReach,
        score,
        rankXCC: null,
        rankAll: 0,
      },
      detail: {
        direct: Array.from(directMap.entries()).map(([creator, info]) => ({
          creator,
          rarity: info.rarity,
          quantity: info.quantity,
        })),
        secondary: secondaryMap,
      },
    });
  }

  // Rank
  scored.sort((a, b) => b.summary.score - a.summary.score || b.summary.directCount - a.summary.directCount);
  for (let i = 0; i < scored.length; i++) scored[i].summary.rankAll = i + 1;

  const xccScored = scored.filter(s => s.summary.isXCC);
  for (let i = 0; i < xccScored.length; i++) xccScored[i].summary.rankXCC = i + 1;

  // Build output
  const walletsSummary: Record<string, WalletScoreSummary> = {};
  for (const s of scored) walletsSummary[s.wallet] = s.summary;

  function toLeaderboardEntry(s: ScoredWallet): LeaderboardEntry {
    return {
      wallet: s.wallet, handle: s.summary.xHandle,
      displayName: s.summary.displayName, score: s.summary.score,
      direct: s.summary.directCount, reach: s.summary.totalReach,
    };
  }

  const walletsDetail: Record<string, WalletScoreDetail> = {};
  for (const s of scored) {
    if (s.summary.directCount > 0) walletsDetail[s.wallet] = s.detail;
  }

  return {
    walletsSummary,
    walletsDetail,
    leaderboard: {
      xcc: xccScored.slice(0, 100).map(toLeaderboardEntry),
      all: scored.slice(0, 100).map(toLeaderboardEntry),
    },
    totalWallets: scored.length,
    totalCreators: TOTAL_CREATORS,
  };
}

// ─── Standalone script entry point ──────────────────────────────────────────

function loadJSON<T>(filename: string): T {
  const path = resolve(REPO_ROOT, filename);
  console.log(`  Loading ${filename}...`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// Only run as standalone script, not when imported by deck-refresh.ts
const isDirectRun = process.argv[1]?.includes('compute-deck-scores');
if (isDirectRun) {
  console.log('Loading data files...');
  const creators = loadJSON<Creator[]>('xeet-creators-full.json');
  const creatorHoldings = loadJSON<Record<string, CreatorHolding>>('creator-holdings.json');
  const holderSnapshot = loadJSON<Record<string, HoldingEntry[]>>('holder-snapshot.json');
  const multiWallet = loadJSON<Record<string, MultiWalletEntry>>('multi-wallet-creators.json');

  console.log(`\nTotal creators: ${creators.length}`);
  console.log(`Total wallets in snapshot: ${Object.keys(holderSnapshot).length}`);
  console.log(`XCC creators with holdings: ${Object.keys(creatorHoldings).length}`);
  console.log(`Multi-wallet creators: ${Object.keys(multiWallet).length}`);

  console.log('\nComputing scores...');
  const start = Date.now();
  const result = computeAllDeckScores(holderSnapshot, creatorHoldings, creators, multiWallet);
  console.log(`Scoring complete in ${Date.now() - start}ms`);

  // Write output
  const scoresPath = resolve(REPO_ROOT, 'deck-scores.json');
  const detailPath = resolve(REPO_ROOT, 'deck-scores-detail.json');

  const deckScores = {
    generated: new Date().toISOString(),
    totalWallets: result.totalWallets,
    totalCreators: result.totalCreators,
    wallets: result.walletsSummary,
    leaderboard: result.leaderboard,
  };

  writeFileSync(scoresPath, JSON.stringify(deckScores, null, 2));
  console.log(`Wrote ${scoresPath}`);

  writeFileSync(detailPath, JSON.stringify(result.walletsDetail));
  console.log(`Wrote ${detailPath}`);

  // Copy to web/public/data/
  if (!existsSync(WEB_PUBLIC_DATA)) mkdirSync(WEB_PUBLIC_DATA, { recursive: true });
  copyFileSync(scoresPath, resolve(WEB_PUBLIC_DATA, 'deck-scores.json'));
  copyFileSync(detailPath, resolve(WEB_PUBLIC_DATA, 'deck-scores-detail.json'));
  copyFileSync(resolve(REPO_ROOT, 'creators-profiles.json'), resolve(WEB_PUBLIC_DATA, 'creators-profiles.json'));
  console.log(`Copied data files to ${WEB_PUBLIC_DATA}`);

  // Stats
  console.log('\n=== Summary ===');
  console.log(`Wallets scored: ${result.totalWallets}`);
  console.log(`Top XCC: ${result.leaderboard.xcc[0]?.handle} — ${result.leaderboard.xcc[0]?.score}% (${result.leaderboard.xcc[0]?.reach}/${result.totalCreators})`);
  console.log(`Top overall: ${result.leaderboard.all[0]?.handle ?? result.leaderboard.all[0]?.wallet.slice(0, 10)} — ${result.leaderboard.all[0]?.score}% (${result.leaderboard.all[0]?.reach}/${result.totalCreators})`);
}
