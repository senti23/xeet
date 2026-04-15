'use client';

import { useMemo, useState } from 'react';
import type { WalletScoreDetail, WalletScoreSummary, CreatorProfiles } from '@/types/deck';
import { type CreatorScore, type Tier, TIER_COLORS, TIER_WEIGHT } from '@/types/xccScores';

interface StrengthEntry {
  wallet: string;
  handle: string | null;
  displayName: string | null;
  isXCC: boolean;
  strength: number;
  cards: number;
  tierCounts: Record<Tier, number>; // total cards at each tier (counting quantity)
}

interface DeckStrengthLeaderboardProps {
  wallets: Record<string, WalletScoreSummary>;
  detail: Record<string, WalletScoreDetail> | null;
  xccScores: CreatorScore[];
  profiles: CreatorProfiles | null;
  highlightWallet: string | null;
  onSelectWallet?: (wallet: string) => void;
}

function truncateWallet(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function Avatar({ handle }: { handle: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!handle || failed) {
    return (
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-800 text-[10px] text-gray-500">
        {handle ? handle[0].toUpperCase() : '?'}
      </div>
    );
  }
  return (
    <img
      src={`/avatars/${handle.toLowerCase()}.jpg`}
      alt=""
      className="h-6 w-6 shrink-0 rounded-full object-cover bg-gray-800"
      onError={() => setFailed(true)}
    />
  );
}

export function DeckStrengthLeaderboard({
  wallets,
  detail,
  xccScores,
  highlightWallet,
  onSelectWallet,
}: DeckStrengthLeaderboardProps) {
  const [tab, setTab] = useState<'xcc' | 'all'>('xcc');

  // ─── Build handle → tier map ──────────────────────────────────────────────
  const tierByHandle = useMemo(() => {
    const m = new Map<string, Tier>();
    for (const c of xccScores) m.set(c.xHandle.toLowerCase(), c.tier);
    return m;
  }, [xccScores]);

  // ─── Compute strength for every wallet ────────────────────────────────────
  const allEntries = useMemo((): StrengthEntry[] => {
    if (!detail) return [];
    const rows: StrengthEntry[] = [];
    for (const [wallet, d] of Object.entries(detail)) {
      let strength = 0;
      let cards = 0;
      const tierCounts: Record<Tier, number> = {
        Mythic: 0, Legendary: 0, Epic: 0, Rare: 0, Common: 0,
      };
      for (const h of d.direct) {
        const tier = tierByHandle.get(h.creator.toLowerCase());
        if (!tier) continue;
        strength += TIER_WEIGHT[tier] * h.quantity;
        cards += h.quantity;
        tierCounts[tier] += h.quantity;
      }
      if (strength === 0) continue;
      const summary = wallets[wallet];
      rows.push({
        wallet,
        handle: summary?.xHandle ?? null,
        displayName: summary?.displayName ?? null,
        isXCC: summary?.isXCC === true,
        strength,
        cards,
        tierCounts,
      });
    }
    rows.sort((a, b) => b.strength - a.strength);
    return rows;
  }, [detail, wallets, tierByHandle]);

  const entries = useMemo(() => {
    const filtered = tab === 'xcc' ? allEntries.filter((e) => e.isXCC) : allEntries;
    return filtered.slice(0, 200);
  }, [allEntries, tab]);

  if (!detail) {
    return (
      <div className="py-8 text-center text-xs text-gray-600">
        Loading wallet holdings...
      </div>
    );
  }

  return (
    <div>
      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] mb-1">
        <button
          onClick={() => setTab('xcc')}
          className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
            tab === 'xcc'
              ? 'text-white border-b-2 border-[#E53935]'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          XCC Creators
        </button>
        <button
          onClick={() => setTab('all')}
          className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
            tab === 'all'
              ? 'text-white border-b-2 border-[#E53935]'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          All Holders
        </button>
      </div>

      <div className="text-[10px] text-gray-600 mb-2 px-1 leading-relaxed">
        Tier-weighted per card: Mythic ×5 · Legendary ×3 · Epic ×2 · Rare ×1 · Common ×0.5
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-gray-600 border-b border-white/[0.06]">
            <th className="px-1.5 py-1.5 text-left w-8">#</th>
            <th className="px-1.5 py-1.5 text-left">Holder</th>
            <th className="px-1.5 py-1.5 text-right w-16">Strength</th>
            <th className="px-1.5 py-1.5 text-right w-14">Cards</th>
            <th className="px-1.5 py-1.5 text-right w-24 hidden sm:table-cell">Tiers</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, i) => {
            const isHighlighted = highlightWallet === entry.wallet;
            return (
              <tr
                key={entry.wallet}
                onClick={() => onSelectWallet?.(entry.wallet)}
                className={`transition-colors cursor-pointer border-b border-white/[0.03] ${
                  isHighlighted ? 'bg-[#E53935]/10' : 'hover:bg-white/[0.03]'
                }`}
              >
                <td className="px-1.5 py-1.5 font-mono text-gray-600">{i + 1}</td>
                <td className="px-1.5 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar handle={entry.handle} />
                    <div className="min-w-0 truncate">
                      {entry.displayName || entry.handle ? (
                        <span className="font-medium text-gray-200 truncate">
                          {entry.displayName || entry.handle}
                        </span>
                      ) : (
                        <span className="font-mono text-gray-500">
                          {truncateWallet(entry.wallet)}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-1.5 py-1.5 text-right font-mono font-bold text-gray-200">
                  {entry.strength.toFixed(1)}
                </td>
                <td className="px-1.5 py-1.5 text-right font-mono text-gray-500">
                  {entry.cards}
                </td>
                <td className="px-1.5 py-1.5 text-right hidden sm:table-cell">
                  <span className="inline-flex items-center gap-0.5">
                    {(['Mythic', 'Legendary', 'Epic', 'Rare', 'Common'] as Tier[]).map((t) => (
                      entry.tierCounts[t] > 0 ? (
                        <span
                          key={t}
                          title={`${t}: ${entry.tierCounts[t]}`}
                          className="inline-block w-1.5 h-1.5 rounded-full"
                          style={{
                            background: TIER_COLORS[t],
                            opacity: Math.min(1, 0.35 + entry.tierCounts[t] * 0.05),
                          }}
                        />
                      ) : null
                    ))}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {entries.length === 200 && (
        <div className="text-center text-[10px] text-gray-600 mt-2 py-1">
          Showing top 200
        </div>
      )}
    </div>
  );
}
