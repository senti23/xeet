'use client';

import { useMemo } from 'react';
import type { DeckScoresData, WalletScoreSummary } from '@/types/deck';

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
  activeDirectCount?: number | null;
}

export function DeckBucketSummary({ scores, activeDirectCount }: DeckBucketSummaryProps) {
  const counts = useMemo(() => {
    const counts: Record<string, number> = { small: 0, medium: 0, large: 0, whale: 0 };
    for (const s of Object.values(scores.wallets)) {
      const ws = s as WalletScoreSummary;
      for (const b of BUCKETS) {
        if (ws.directCount >= b.min && ws.directCount <= b.max) {
          counts[b.label]++;
          break;
        }
      }
    }
    return counts;
  }, [scores]);

  const activeLabel = useMemo(() => {
    if (activeDirectCount == null) return null;
    for (const b of BUCKETS) {
      if (activeDirectCount >= b.min && activeDirectCount <= b.max) return b.label;
    }
    return null;
  }, [activeDirectCount]);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[rgba(10,10,10,0.9)] px-4 py-3">
      <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
        Wallet categories
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
