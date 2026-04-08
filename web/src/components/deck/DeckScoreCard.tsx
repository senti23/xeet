'use client';

import type { WalletScoreSummary, ValuationResponse } from '@/types/deck';

interface DeckScoreCardProps {
  wallet: WalletScoreSummary;
  address: string;
  totalCreators: number;
  valuation?: ValuationResponse | null;
}

export function DeckScoreCard({ wallet, address, totalCreators, valuation }: DeckScoreCardProps) {
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

      {/* Deck Valuation */}
      {valuation && (
        <div className="mt-5 border-t border-deck-border pt-4">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Deck Value (OS Sales)</p>
          <div className="flex gap-5 flex-wrap">
            <div>
              <p className="font-[family-name:var(--font-space-mono)] text-lg font-bold" style={{ color: '#378ADD' }}>
                {valuation.valuation.highest.totalEth.toFixed(4)} ETH
              </p>
              {valuation.valuation.highest.totalUsd != null && (
                <p className="text-xs text-gray-500">
                  ~${valuation.valuation.highest.totalUsd.toLocaleString()}
                </p>
              )}
              <p className="text-[9px] text-gray-600 mt-0.5">Highest sale</p>
            </div>
            <div>
              <p className="font-[family-name:var(--font-space-mono)] text-lg font-bold text-gray-400">
                {valuation.valuation.median.totalEth.toFixed(4)} ETH
              </p>
              {valuation.valuation.median.totalUsd != null && (
                <p className="text-xs text-gray-500">
                  ~${valuation.valuation.median.totalUsd.toLocaleString()}
                </p>
              )}
              <p className="text-[9px] text-gray-600 mt-0.5">Median sale</p>
            </div>
            {valuation.costBasis.cardsWithCost > 0 && (
              <div>
                <p className="font-[family-name:var(--font-space-mono)] text-lg font-bold" style={{ color: '#D85A30' }}>
                  {valuation.costBasis.totalEth.toFixed(4)} ETH
                </p>
                {valuation.costBasis.totalUsd != null && (
                  <p className="text-xs text-gray-500">
                    ~${valuation.costBasis.totalUsd.toLocaleString()}
                  </p>
                )}
                <p className="text-[9px] text-gray-600 mt-0.5">
                  Cost basis ({valuation.costBasis.cardsWithCost} cards)
                </p>
              </div>
            )}
          </div>
          <p className="text-[9px] text-gray-600 mt-1">
            {valuation.cardsWithValue}/{valuation.totalCards} cards valued
          </p>
        </div>
      )}
    </div>
  );
}
