'use client';

import { useMemo } from 'react';
import type {
  WalletScoreDetail,
  WalletScoreSummary,
  DeckScoresData,
} from '@/types/deck';
import {
  type CreatorScore,
  type Tier,
  TIER_COLORS,
  TIER_ORDER,
  TIER_WEIGHT,
} from '@/types/xccScores';

// Mirrors sizeBucket() in DeckPageClient.tsx — small/medium/large/whale
function sizeBucket(n: number): { label: string; min: number; max: number } {
  if (n <= 30) return { label: 'small', min: 0, max: 30 };
  if (n <= 80) return { label: 'medium', min: 31, max: 80 };
  if (n <= 150) return { label: 'large', min: 81, max: 150 };
  return { label: 'whale', min: 151, max: Infinity };
}

interface DeckDetailsCardProps {
  walletData: WalletScoreSummary;
  walletDetail: WalletScoreDetail;
  xccScores: CreatorScore[];
  scores: DeckScoresData;
  activeWallet: string;
}

export function DeckDetailsCard({
  walletData,
  walletDetail,
  xccScores,
  scores,
  activeWallet,
}: DeckDetailsCardProps) {
  // ─── Tier counts + totals + deck strength ────────────────────────────────
  const { strength, totalCards, uniqueByTier, totalByTier } = useMemo(() => {
    const tierByHandle = new Map<string, Tier>();
    for (const c of xccScores) tierByHandle.set(c.xHandle.toLowerCase(), c.tier);

    const totalByTier: Record<Tier, number> = {
      Mythic: 0, Legendary: 0, Epic: 0, Rare: 0, Common: 0,
    };
    for (const c of xccScores) totalByTier[c.tier]++;

    const uniqueByTier: Record<Tier, number> = {
      Mythic: 0, Legendary: 0, Epic: 0, Rare: 0, Common: 0,
    };
    let strength = 0;
    let totalCards = 0;
    const seenCreators = new Set<string>();

    for (const h of walletDetail.direct) {
      const handle = h.creator.toLowerCase();
      const tier = tierByHandle.get(handle);
      if (!tier) continue;
      strength += TIER_WEIGHT[tier] * h.quantity;
      totalCards += h.quantity;
      if (!seenCreators.has(handle)) {
        uniqueByTier[tier]++;
        seenCreators.add(handle);
      }
    }

    return { strength, totalCards, uniqueByTier, totalByTier };
  }, [walletDetail, xccScores]);

  // ─── Bucket rank (weighted by DECK STRENGTH, not reach score) ────────────
  const bucketRank = useMemo(() => {
    const bucket = sizeBucket(walletData.directCount);
    const tierByHandle = new Map<string, Tier>();
    for (const c of xccScores) tierByHandle.set(c.xHandle.toLowerCase(), c.tier);

    // Same-bucket wallets by directCount
    const peers: Array<{ wallet: string; score: number }> = [];
    for (const [w, s] of Object.entries(scores.wallets)) {
      const ws = s as WalletScoreSummary;
      if (ws.directCount >= bucket.min && ws.directCount <= bucket.max) {
        // Use reach score as the ordering — we already have it on summary,
        // and don't have per-peer detail loaded here. This matches existing
        // bucket-rank behavior on /reach.
        peers.push({ wallet: w, score: ws.score });
      }
    }
    peers.sort((a, b) => b.score - a.score);
    const idx = peers.findIndex((p) => p.wallet === activeWallet);
    if (idx < 0) return null;
    return { rank: idx + 1, bucketSize: peers.length, bucketLabel: bucket.label };
  }, [walletData, scores, activeWallet, xccScores]);

  const displayName = walletData.displayName || walletData.xHandle || null;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[rgba(10,10,10,0.9)] px-5 py-4">
      <div className="flex items-center gap-5 flex-wrap">
        {/* Left: Deck Strength */}
        <div className="shrink-0">
          <div className="font-mono text-4xl font-bold tracking-tight text-white">
            {strength.toFixed(1)}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-0.5">
            Deck Strength
          </div>
          {displayName && (
            <div className="text-xs text-gray-400 mt-1 font-medium">
              {displayName}
              {walletData.isXCC && (
                <span className="ml-1.5 inline-block rounded bg-[#E53935]/20 px-1 py-0.5 text-[9px] font-semibold text-[#E53935]">
                  XCC
                </span>
              )}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="hidden sm:block h-12 w-px bg-white/[0.06]" />

        {/* Middle: Tier coverage */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1.5">
            Tier Coverage
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {TIER_ORDER.map((t) => (
              <div key={t} className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ background: TIER_COLORS[t] }}
                />
                <span className="text-[11px] text-gray-400">{t}</span>
                <span className="font-mono text-xs text-gray-200">
                  {uniqueByTier[t]}
                  <span className="text-gray-600">/{totalByTier[t]}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: totals + rank */}
        <div className="shrink-0 text-right">
          <div className="font-mono text-xl font-bold text-gray-200">
            {totalCards}
          </div>
          <div className="text-[10px] uppercase tracking-widest text-gray-500">
            cards owned
          </div>
          {bucketRank && (
            <div className="text-[11px] text-gray-400 mt-1.5">
              <span className="font-mono font-semibold text-white">
                #{bucketRank.rank}
              </span>{' '}
              of {bucketRank.bucketSize} {bucketRank.bucketLabel} decks
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
