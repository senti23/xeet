'use client';

import { useMemo } from 'react';
import type { WalletScoreDetail, WalletScoreSummary, DeckScoresData } from '@/types/deck';
import { type CreatorScore, type Tier, TIER_COLORS, TIER_ORDER } from '@/types/xccScores';

interface DeckStatsBarProps {
  walletData: WalletScoreSummary;
  walletDetail: WalletScoreDetail;
  xccScores: CreatorScore[];
  scores: DeckScoresData;
  totalCreators: number;
}

function sizeBucket(n: number): { label: string; min: number; max: number } {
  if (n <= 30) return { label: 'small', min: 0, max: 30 };
  if (n <= 80) return { label: 'medium', min: 31, max: 80 };
  if (n <= 150) return { label: 'large', min: 81, max: 150 };
  return { label: 'whale', min: 151, max: Infinity };
}

export function DeckStatsBar({
  walletData,
  walletDetail,
  xccScores,
  scores,
  totalCreators,
}: DeckStatsBarProps) {
  // Compute tier counts for held cards
  const { tierCounts, tierTotals } = useMemo(() => {
    const counts: Record<Tier, number> = {
      Mythic: 0, Legendary: 0, Epic: 0, Rare: 0, Common: 0,
    };
    const totals: Record<Tier, number> = {
      Mythic: 0, Legendary: 0, Epic: 0, Rare: 0, Common: 0,
    };

    const held = new Set(walletDetail.direct.map(d => d.creator.toLowerCase()));

    for (const c of xccScores) {
      totals[c.tier]++;
      if (held.has(c.xHandle.toLowerCase())) {
        counts[c.tier]++;
      }
    }

    return { tierCounts: counts, tierTotals: totals };
  }, [walletDetail, xccScores]);

  // Rank within deck size bucket
  const bucketInfo = useMemo(() => {
    const bucket = sizeBucket(walletData.directCount);

    // Find all wallets in the same bucket
    const bucketWallets: Array<{ wallet: string; score: number }> = [];
    for (const [wallet, summary] of Object.entries(scores.wallets)) {
      const s = summary as WalletScoreSummary;
      if (s.directCount >= bucket.min && s.directCount <= bucket.max) {
        bucketWallets.push({ wallet, score: s.score });
      }
    }

    bucketWallets.sort((a, b) => b.score - a.score);

    const targetWallet = Object.entries(scores.wallets).find(
      ([, s]) => (s as WalletScoreSummary).directCount === walletData.directCount
        && (s as WalletScoreSummary).score === walletData.score,
    )?.[0];

    let rank = -1;
    if (targetWallet) {
      rank = bucketWallets.findIndex(b => b.wallet === targetWallet) + 1;
    }

    return {
      label: bucket.label,
      bucketSize: bucketWallets.length,
      rank,
    };
  }, [walletData, scores]);

  const reachPct = (walletData.totalReach / totalCreators) * 100;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[rgba(20,20,20,0.9)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {/* Tier counts */}
        <div className="flex items-center gap-3 flex-wrap">
          {TIER_ORDER.map((tier) => {
            const count = tierCounts[tier];
            const total = tierTotals[tier];
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={tier} className="flex items-center gap-1.5 text-[11px]">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: TIER_COLORS[tier] }}
                />
                <span className="text-gray-400">{tier}</span>
                <span
                  className="font-mono font-semibold"
                  style={{ color: count > 0 ? TIER_COLORS[tier] : '#555' }}
                >
                  {count}/{total}
                </span>
                <span className="text-[9px] text-gray-600 font-mono">
                  ({pct.toFixed(0)}%)
                </span>
              </div>
            );
          })}
        </div>

        {/* Separator */}
        <span className="hidden md:inline-block h-4 w-px bg-white/10" />

        {/* Reach */}
        <div className="text-[11px] text-gray-400">
          Reach{' '}
          <span className="font-mono font-semibold text-white">
            {walletData.totalReach}/{totalCreators}
          </span>
          <span className="ml-1 text-[#378ADD] font-mono">
            ({reachPct.toFixed(1)}%)
          </span>
        </div>

        {/* Bucket rank */}
        {bucketInfo.rank > 0 && (
          <>
            <span className="hidden md:inline-block h-4 w-px bg-white/10" />
            <div className="text-[11px] text-gray-400">
              Ranked{' '}
              <span className="font-mono font-semibold text-[#E53935]">
                #{bucketInfo.rank}
              </span>{' '}
              of{' '}
              <span className="font-mono text-white">{bucketInfo.bucketSize}</span>{' '}
              {bucketInfo.label} decks
              <span className="ml-1 text-[9px] text-gray-600">
                ({sizeBucket(walletData.directCount).min}–
                {sizeBucket(walletData.directCount).max === Infinity
                  ? '∞'
                  : sizeBucket(walletData.directCount).max}{' '}
                cards)
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
