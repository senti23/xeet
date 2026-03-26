'use client';

import type { WalletScoreSummary } from '@/types/deck';

interface DeckScoreCardProps {
  wallet: WalletScoreSummary;
  address: string;
  totalCreators: number;
}

export function DeckScoreCard({ wallet, address, totalCreators }: DeckScoreCardProps) {
  const scoreColor =
    wallet.score >= 80
      ? 'text-deck-red'
      : wallet.score >= 50
        ? 'text-deck-teal'
        : 'text-deck-coral';

  return (
    <div className="rounded-2xl border border-deck-border bg-[--color-deck-card] p-6">
      {/* Identity */}
      <div className="mb-4">
        {wallet.isXCC && wallet.displayName ? (
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold">{wallet.displayName}</span>
            <span className="text-sm text-gray-500">@{wallet.xHandle}</span>
            <span className="rounded-full bg-deck-red/20 px-2 py-0.5 text-xs font-medium text-deck-red">
              XCC
            </span>
          </div>
        ) : (
          <p className="font-mono text-sm text-gray-400">
            {address.slice(0, 6)}...{address.slice(-4)}
          </p>
        )}
      </div>

      {/* Score */}
      <div className="mb-4">
        <p className={`font-[family-name:var(--font-space-mono)] text-5xl font-bold ${scoreColor}`}>
          {wallet.score}%
        </p>
        <p className="mt-1 text-sm text-gray-400">
          {wallet.totalReach} / {totalCreators} creators reachable
        </p>
      </div>

      {/* Direct / Secondary */}
      <div className="mb-4 flex gap-6">
        <div>
          <p className="font-[family-name:var(--font-space-mono)] text-2xl font-bold" style={{ color: '#888780' }}>
            {wallet.directCount}
          </p>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Direct</p>
        </div>
        <div>
          <p className="font-[family-name:var(--font-space-mono)] text-2xl font-bold" style={{ color: '#378ADD' }}>
            {wallet.secondaryCount}
          </p>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Secondary</p>
        </div>
        <div>
          <p className="font-[family-name:var(--font-space-mono)] text-2xl font-bold" style={{ color: '#D85A30' }}>
            {wallet.totalReach}
          </p>
          <p className="text-xs text-gray-500 uppercase tracking-wider">Total</p>
        </div>
      </div>

      {/* Rank badges */}
      <div className="flex gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-sm">
          <span className="text-gray-500">Overall</span>
          <span className="font-[family-name:var(--font-space-mono)] font-bold">#{wallet.rankAll}</span>
        </span>
        {wallet.isXCC && wallet.rankXCC != null && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-deck-red/15 px-3 py-1.5 text-sm">
            <span className="text-deck-red/70">XCC</span>
            <span className="font-[family-name:var(--font-space-mono)] font-bold text-deck-red">
              #{wallet.rankXCC}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
