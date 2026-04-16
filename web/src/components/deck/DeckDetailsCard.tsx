'use client';

import { useMemo } from 'react';
import type {
  WalletScoreDetail,
  WalletScoreSummary,
} from '@/types/deck';
import {
  type CreatorScore,
  type Tier,
  type CardRarity,
  TIER_COLORS,
  TIER_ORDER,
  TIER_WEIGHT,
  RARITY_WEIGHT,
} from '@/types/xccScores';

// Card-rarity colors (distinct from creator-tier colors).
// Legendary cards are gold, rare = blue, common = neutral.
const RARITY_COLORS: Record<'legendary' | 'rare' | 'common', string> = {
  legendary: '#D85A30',
  rare: '#378ADD',
  common: '#888780',
};
const RARITY_ORDER: Array<'legendary' | 'rare' | 'common'> = [
  'legendary',
  'rare',
  'common',
];

// Size buckets are by TOTAL CARDS HELD on /deck — matches user's mental model
// ("I have 152 cards → whale"). /reach uses a different concept.
function cardBucket(n: number): { label: string; min: number; max: number } {
  if (n <= 30) return { label: 'small', min: 0, max: 30 };
  if (n <= 80) return { label: 'medium', min: 31, max: 80 };
  if (n <= 150) return { label: 'large', min: 81, max: 150 };
  return { label: 'whale', min: 151, max: Infinity };
}

interface DeckDetailsCardProps {
  walletData: WalletScoreSummary;
  walletDetail: WalletScoreDetail;
  xccScores: CreatorScore[];
  /** Full detail map — needed to rank same-bucket peers by deck strength. */
  detailCache: Record<string, WalletScoreDetail> | null;
  activeWallet: string;
}

export function DeckDetailsCard({
  walletData,
  walletDetail,
  xccScores,
  detailCache,
  activeWallet,
}: DeckDetailsCardProps) {
  // ─── Own deck: strength + totals + rarity counts + tier counts ───────────
  const {
    strength,
    totalCards,
    uniqueByTier,
    totalByTier,
    rarityCounts,
  } = useMemo(() => {
    const tierByHandle = new Map<string, Tier>();
    for (const c of xccScores) tierByHandle.set(c.xHandle.toLowerCase(), c.tier);

    const totalByTier: Record<Tier, number> = {
      Mythic: 0, Legendary: 0, Epic: 0, Rare: 0, Common: 0,
    };
    for (const c of xccScores) totalByTier[c.tier]++;

    const uniqueByTier: Record<Tier, number> = {
      Mythic: 0, Legendary: 0, Epic: 0, Rare: 0, Common: 0,
    };
    const rarityCounts: Record<'legendary' | 'rare' | 'common', number> = {
      legendary: 0, rare: 0, common: 0,
    };
    let strength = 0;
    let totalCards = 0;
    const seenCreators = new Set<string>();

    for (const h of walletDetail.direct) {
      const handle = h.creator.toLowerCase();
      const tier = tierByHandle.get(handle);
      const qty = h.quantity;

      // Rarity counts — by CARD rarity (h.rarity), summing quantity.
      const r = (h.rarity || '').toLowerCase() as CardRarity;
      if (r in rarityCounts) rarityCounts[r] += qty;

      // Strength + totals — require known creator tier.
      if (!tier) continue;
      const rarityMult = RARITY_WEIGHT[r] ?? 1;
      strength += TIER_WEIGHT[tier] * rarityMult * qty;
      totalCards += qty;
      if (!seenCreators.has(handle)) {
        uniqueByTier[tier]++;
        seenCreators.add(handle);
      }
    }

    return { strength, totalCards, uniqueByTier, totalByTier, rarityCounts };
  }, [walletDetail, xccScores]);

  // ─── Bucket rank — by TOTAL CARDS, ranked by DECK STRENGTH ───────────────
  const bucketRank = useMemo(() => {
    if (!detailCache) return null;

    const tierByHandle = new Map<string, Tier>();
    for (const c of xccScores) tierByHandle.set(c.xHandle.toLowerCase(), c.tier);

    const bucket = cardBucket(totalCards);

    type Peer = { wallet: string; strength: number; cards: number };
    const peers: Peer[] = [];
    for (const [w, d] of Object.entries(detailCache)) {
      let pStrength = 0;
      let pCards = 0;
      for (const h of d.direct) {
        const tier = tierByHandle.get(h.creator.toLowerCase());
        if (!tier) continue;
        const r = (h.rarity || '').toLowerCase() as CardRarity;
        const rarityMult = RARITY_WEIGHT[r] ?? 1;
        pStrength += TIER_WEIGHT[tier] * rarityMult * h.quantity;
        pCards += h.quantity;
      }
      if (pStrength === 0) continue;
      if (pCards >= bucket.min && pCards <= bucket.max) {
        peers.push({ wallet: w, strength: pStrength, cards: pCards });
      }
    }
    peers.sort((a, b) => b.strength - a.strength);
    const idx = peers.findIndex((p) => p.wallet === activeWallet);
    if (idx < 0) return null;
    return { rank: idx + 1, bucketSize: peers.length, bucketLabel: bucket.label };
  }, [detailCache, xccScores, totalCards, activeWallet]);

  const displayName = walletData.displayName || walletData.xHandle || null;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-[rgba(10,10,10,0.9)] px-5 py-4 space-y-3">
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

        {/* Middle: two rows — Card Rarity, then Creator Tier Coverage */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Row 1: card rarity (legendary / rare / common) — by CARD, summed by quantity */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
              Card Rarity
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {RARITY_ORDER.map((r) => (
                <div key={r} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{ background: RARITY_COLORS[r] }}
                  />
                  <span className="text-[11px] text-gray-400 capitalize">{r}</span>
                  <span className="font-mono text-xs text-gray-200">
                    {rarityCounts[r]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Row 2: creator tier coverage (Mythic / Legendary / Epic / Rare / Common) —
              unique creators whose cards you hold, over total creators in that tier */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">
              Creator Tier Coverage
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
          {!bucketRank && detailCache === null && (
            <div className="text-[10px] text-gray-600 mt-1.5">
              loading rank…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

