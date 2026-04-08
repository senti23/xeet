'use client';

import { useState, useEffect } from 'react';
import type { UpgradesResponse, UpgradeOpportunity } from '@/types/deck';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const RARITY_COLORS: Record<string, string> = {
  legendary: '#D85A30',
  rare: '#378ADD',
  common: '#888780',
};

const TIER_CONFIG: Record<string, { emoji: string; color: string; label: string }> = {
  strong_upgrade: { emoji: '🟢', color: '#5DCAA5', label: 'Strong' },
  decent_upgrade: { emoji: '🟡', color: '#E5A838', label: 'Decent' },
  consider: { emoji: '⚪', color: '#888780', label: 'Consider' },
};

function SmallAvatar({ handle }: { handle: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-800 text-[9px] text-gray-500">
        {handle[0]?.toUpperCase() || '?'}
      </div>
    );
  }
  return (
    <img
      src={`/avatars/${handle.toLowerCase()}.jpg`}
      alt=""
      className="h-5 w-5 shrink-0 rounded-full object-cover bg-gray-800"
      onError={() => setFailed(true)}
    />
  );
}

function RarityDot({ rarity }: { rarity: string }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ background: RARITY_COLORS[rarity] || RARITY_COLORS.common }}
    />
  );
}

function formatEth(value: number): string {
  if (value < 0.001) return value.toFixed(5);
  if (value < 0.01) return value.toFixed(4);
  return value.toFixed(3);
}

interface DeckUpgradesPanelProps {
  wallet: string;
}

export function DeckUpgradesPanel({ wallet }: DeckUpgradesPanelProps) {
  const [data, setData] = useState<UpgradesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet) return;
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/deck/upgrades?wallet=${wallet}`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d: UpgradesResponse) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [wallet]);

  if (loading) {
    return (
      <div className="space-y-2 py-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded-lg bg-gray-800/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-6 text-center text-xs text-gray-500">
        Could not load upgrade data
      </div>
    );
  }

  if (!data || data.opportunities.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-gray-500">
        No upgrade opportunities found — all your cards are already at their best rarity-to-price ratio, or floor data is unavailable.
      </div>
    );
  }

  const ethUsd = data.ethUsdRate || 0;

  return (
    <div className="max-h-[500px] overflow-y-auto">
      <p className="text-[9px] text-gray-600 uppercase tracking-wider mb-2 px-1">
        {data.totalOpportunities} opportunities · sorted by value ratio
      </p>

      <div className="space-y-1.5">
        {data.opportunities.map((o: UpgradeOpportunity) => {
          const tier = TIER_CONFIG[o.tier] || TIER_CONFIG.consider;

          return (
            <div
              key={`${o.creator}-${o.currentRarity}`}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 border border-white/[0.04] hover:border-white/[0.08] transition-colors"
              style={{ background: 'rgba(20, 20, 20, 0.6)' }}
            >
              {/* Avatar + name */}
              <SmallAvatar handle={o.creator} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-gray-200 truncate font-medium">
                    {o.displayName}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[9px] text-gray-500">
                  <RarityDot rarity={o.currentRarity} />
                  <span className="capitalize">{o.currentRarity}</span>
                  <span className="text-gray-600">→</span>
                  <RarityDot rarity={o.upgradeRarity} />
                  <span className="capitalize">{o.upgradeRarity}</span>
                </div>
              </div>

              {/* Prices */}
              <div className="text-right shrink-0">
                <div className="flex items-center gap-1.5 text-[10px] font-mono">
                  <span className="text-gray-500">{formatEth(o.currentFloorEth)}</span>
                  <span className="text-gray-600">→</span>
                  <span className="text-gray-300">{formatEth(o.upgradeFloorEth)}</span>
                </div>
                {ethUsd > 0 && (
                  <div className="text-[8px] text-gray-600 font-mono">
                    ${Math.round(o.currentFloorEth * ethUsd)} → ${Math.round(o.upgradeFloorEth * ethUsd)}
                  </div>
                )}
              </div>

              {/* Ratio badge */}
              <div
                className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-mono font-bold"
                style={{
                  color: tier.color,
                  background: `${tier.color}15`,
                  border: `1px solid ${tier.color}30`,
                }}
              >
                {o.ratio}x
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
