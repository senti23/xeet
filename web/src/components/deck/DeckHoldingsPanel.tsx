'use client';

import { useState, useMemo } from 'react';
import type { DirectHolding, CreatorProfiles } from '@/types/deck';

const RARITY_COLORS: Record<string, string> = {
  legendary: '#D85A30',
  rare: '#378ADD',
  common: '#888780',
};

const RARITY_ORDER: Record<string, number> = { legendary: 0, rare: 1, common: 2 };

interface DeckHoldingsPanelProps {
  holdings: DirectHolding[];
  profiles: CreatorProfiles | null;
  bridgeIndex: Record<string, string[]>; // from detail.secondary: creator -> bridging XCCs
  creatorCardCounts: Record<string, number>; // handle -> how many cards they hold
}

type SortKey = 'creator' | 'rarity' | 'theirCards' | 'bridges';
type SortDir = 'asc' | 'desc';

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

export function DeckHoldingsPanel({
  holdings,
  profiles,
  bridgeIndex,
  creatorCardCounts,
}: DeckHoldingsPanelProps) {
  const [sortKey, setSortKey] = useState<SortKey>('theirCards');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Pre-compute: for each direct holding, how many secondary creators does it bridge to?
  // bridgeIndex = Record<secondaryCreator, bridgingXCCHandles[]>
  // We need: for each directHolding.creator, count how many secondaryCreators list it as a bridge
  const bridgeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [, bridges] of Object.entries(bridgeIndex)) {
      for (const b of bridges) {
        const lc = b.toLowerCase();
        counts.set(lc, (counts.get(lc) || 0) + 1);
      }
    }
    return counts;
  }, [bridgeIndex]);

  // Enrich holdings with bridge count and their card count
  const enriched = useMemo(() => {
    return holdings.map((h) => {
      const lc = h.creator.toLowerCase();
      const bridgeCount = bridgeCounts.get(lc) || 0;
      const theirCards = creatorCardCounts[lc] ?? creatorCardCounts[h.creator] ?? 0;
      return { ...h, bridgeCount, theirCards, lc };
    });
  }, [holdings, bridgeCounts, creatorCardCounts]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...enriched];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'creator':
          return dir * a.lc.localeCompare(b.lc);
        case 'rarity':
          return dir * ((RARITY_ORDER[a.rarity] ?? 2) - (RARITY_ORDER[b.rarity] ?? 2));
        case 'theirCards':
          return dir * (a.theirCards - b.theirCards);
        case 'bridges':
          return dir * (a.bridgeCount - b.bridgeCount);
        default:
          return 0;
      }
    });
    return arr;
  }, [enriched, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'creator' ? 'asc' : 'asc');
    }
  };

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  return (
    <div className="max-h-[400px] overflow-y-auto">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-[rgba(20,20,20,0.98)]">
          <tr className="text-[9px] uppercase tracking-wider text-gray-600">
            <th
              className="px-1 py-1.5 text-left cursor-pointer hover:text-gray-400 transition-colors"
              onClick={() => toggleSort('creator')}
            >
              Creator{sortArrow('creator')}
            </th>
            <th
              className="px-1 py-1.5 text-center w-8 cursor-pointer hover:text-gray-400 transition-colors"
              onClick={() => toggleSort('rarity')}
              title="Rarity"
            >
              R{sortArrow('rarity')}
            </th>
            <th
              className="px-1 py-1.5 text-right w-14 cursor-pointer hover:text-gray-400 transition-colors"
              onClick={() => toggleSort('theirCards')}
              title="Cards they hold"
            >
              Cards{sortArrow('theirCards')}
            </th>
            <th
              className="px-1 py-1.5 text-right w-14 cursor-pointer hover:text-gray-400 transition-colors"
              onClick={() => toggleSort('bridges')}
              title="Secondary creators bridged"
            >
              Bridges{sortArrow('bridges')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => {
            const lowActivity = h.theirCards < 10;
            return (
              <tr
                key={`${h.creator}-${h.rarity}`}
                className={`border-b border-white/[0.03] ${
                  lowActivity ? 'bg-red-500/[0.04]' : ''
                }`}
              >
                <td className="px-1 py-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <SmallAvatar handle={h.creator} />
                    <span className="text-gray-300 truncate">{h.creator}</span>
                  </div>
                </td>
                <td className="px-1 py-1.5 text-center">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: RARITY_COLORS[h.rarity] || RARITY_COLORS.common }}
                  />
                </td>
                <td
                  className={`px-1 py-1.5 text-right font-mono ${
                    lowActivity ? 'text-red-400/70' : 'text-gray-500'
                  }`}
                >
                  {h.theirCards}
                </td>
                <td className={`px-1 py-1.5 text-right font-mono ${
                  h.bridgeCount > 50 ? 'text-[#378ADD] font-semibold' : h.bridgeCount > 0 ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  {h.bridgeCount}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
