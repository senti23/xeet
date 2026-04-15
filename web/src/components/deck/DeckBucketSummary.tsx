'use client';

import { useMemo } from 'react';
import type { DeckScoresData, WalletScoreDetail } from '@/types/deck';

const BUCKETS: Array<{
  label: string;
  range: string;
  min: number;
  max: number;
}> = [
  { label: 'small',  range: '0–30',    min: 0,   max: 30 },
  { label: 'medium', range: '31–80',   min: 31,  max: 80 },
  { label: 'large',  range: '81–150',  min: 81,  max: 150 },
  { label: 'whale',  range: '151+',    min: 151, max: Infinity },
];

interface DeckBucketSummaryProps {
  scores: DeckScoresData;
  /** Full detail map — bucketing is by TOTAL CARDS (sum of quantities). */
  detailCache: Record<string, WalletScoreDetail> | null;
  /** Total cards held by the active wallet (null if no wallet selected). */
  activeTotalCards?: number | null;
  /**
   * Fallback: how many unique creators the active wallet holds. Used only
   * when detailCache hasn't loaded yet so we can show a best-effort "YOU"
   * pill (via the summary's `directCount`). Once detailCache loads, the
   * `activeTotalCards` path takes over with the true card total.
   */
  activeDirectCount?: number | null;
}

export function DeckBucketSummary({
  scores,
  detailCache,
  activeTotalCards,
  activeDirectCount,
}: DeckBucketSummaryProps) {
  const counts = useMemo(() => {
    const counts: Record<string, number> = { small: 0, medium: 0, large: 0, whale: 0 };

    if (detailCache) {
      // Authoritative bucketing by total cards once detail is loaded.
      for (const d of Object.values(detailCache)) {
        let cards = 0;
        for (const h of d.direct) cards += h.quantity;
        if (cards === 0) continue;
        for (const b of BUCKETS) {
          if (cards >= b.min && cards <= b.max) { counts[b.label]++; break; }
        }
      }
    } else {
      // Fallback while detail loads: approximate with directCount so the
      // strip renders something instead of all zeros.
      for (const s of Object.values(scores.wallets)) {
        const n = s.directCount;
        for (const b of BUCKETS) {
          if (n >= b.min && n <= b.max) { counts[b.label]++; break; }
        }
      }
    }
    return counts;
  }, [scores, detailCache]);

  const activeLabel = useMemo(() => {
    const n = activeTotalCards ?? activeDirectCount;
    if (n == null) return null;
    for (const b of BUCKETS) {
      if (n >= b.min && n <= b.max) return b.label;
    }
    return null;
  }, [activeTotalCards, activeDirectCount]);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[rgba(10,10,10,0.9)] px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
        Wallet categories{' '}
        <span className="text-gray-700 normal-case tracking-normal">
          (by total cards held)
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {BUCKETS.map((b) => {
          const isActive = activeLabel === b.label;
          return (
            <div
              key={b.label}
              className={`flex items-baseline gap-1.5 ${
                isActive ? 'text-white' : 'text-gray-400'
              }`}
            >
              <span className="font-mono text-sm font-semibold">
                {counts[b.label].toLocaleString()}
              </span>
              <span className="text-xs capitalize">{b.label}</span>
              <span className="text-[10px] text-gray-600 font-mono">
                ({b.range} cards)
              </span>
              {isActive && (
                <span className="ml-0.5 rounded bg-[#E53935]/20 px-1 py-0.5 text-[9px] font-semibold text-[#E53935]">
                  YOU
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
