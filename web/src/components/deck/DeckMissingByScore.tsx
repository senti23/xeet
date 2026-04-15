'use client';

import { useState, useMemo } from 'react';
import type { WalletScoreDetail } from '@/types/deck';
import { type CreatorScore, type Tier, TIER_COLORS } from '@/types/xccScores';

interface DeckMissingByScoreProps {
  xccScores: CreatorScore[];
  walletDetail: WalletScoreDetail | null;
  onCreatorClick?: (handle: string) => void;
}

function Avatar({ handle, name, size = 24 }: { handle: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="shrink-0 flex items-center justify-center rounded-full bg-gray-800 text-gray-500"
        style={{ width: size, height: size, fontSize: size * 0.45 }}
      >
        {name[0]?.toUpperCase() || '?'}
      </div>
    );
  }
  return (
    <img
      src={`/avatars/${handle.toLowerCase()}.jpg`}
      alt=""
      className="shrink-0 rounded-full object-cover bg-gray-800"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

const TIER_ORDER_FILTER: (Tier | 'All')[] = ['All', 'Mythic', 'Legendary', 'Epic', 'Rare', 'Common'];

export function DeckMissingByScore({
  xccScores,
  walletDetail,
  onCreatorClick,
}: DeckMissingByScoreProps) {
  const [filter, setFilter] = useState<Tier | 'All'>('All');

  const missing = useMemo(() => {
    if (!walletDetail) return [];
    const held = new Set(walletDetail.direct.map((d) => d.creator.toLowerCase()));
    return xccScores
      .filter((c) => !held.has(c.xHandle.toLowerCase()))
      .filter((c) => filter === 'All' || c.tier === filter)
      .sort((a, b) => b.compositeScore - a.compositeScore);
  }, [xccScores, walletDetail, filter]);

  if (!walletDetail) {
    return (
      <div className="py-4 text-center text-xs text-gray-600">
        Search a wallet first
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Tier filter chips */}
      <div className="flex items-center gap-1 flex-wrap">
        {TIER_ORDER_FILTER.map((t) => {
          const active = filter === t;
          const color = t === 'All' ? '#888' : TIER_COLORS[t];
          return (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
                active ? 'text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
              style={{
                background: active ? `${color}33` : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? color : 'rgba(255,255,255,0.08)'}`,
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      {missing.length === 0 ? (
        <div className="rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-3 text-center">
          <div className="text-sm font-medium text-green-400">
            {filter === 'All'
              ? 'You hold all 391 creators!'
              : `You hold every ${filter} creator`}
          </div>
        </div>
      ) : (
        <ul className="space-y-0.5">
          {missing.map((c, i) => (
            <li key={c.xHandle}>
              <button
                onClick={() => onCreatorClick?.(c.xHandle.toLowerCase())}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-white/[0.04] transition-colors cursor-pointer"
              >
                <span className="text-[10px] text-gray-600 font-mono w-6 shrink-0">
                  #{i + 1}
                </span>
                <Avatar handle={c.xHandle} name={c.displayName} size={22} />
                <span className="flex-1 min-w-0 truncate text-xs text-gray-200">
                  {c.displayName}
                </span>
                <span
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    background: `${TIER_COLORS[c.tier]}22`,
                    color: TIER_COLORS[c.tier],
                  }}
                >
                  {c.tier}
                </span>
                <span className="text-[10px] text-gray-500 font-mono w-10 text-right shrink-0">
                  {c.compositeScore.toFixed(1)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
