'use client';

import { useState, useMemo } from 'react';
import type { DirectHolding, CreatorProfiles, ValuationCard } from '@/types/deck';

const RARITY_COLORS: Record<string, string> = {
  legendary: '#D85A30',
  rare: '#378ADD',
  common: '#888780',
};

const RARITY_ORDER: Record<string, number> = { legendary: 0, rare: 1, common: 2 };

interface DeckHoldingsPanelProps {
  holdings: DirectHolding[];
  profiles: CreatorProfiles | null;
  bridgeIndex: Record<string, string[]>;
  creatorCardCounts: Record<string, number>;
  valuationCards?: ValuationCard[];
  ethUsdRate?: number;
}

type SortKey = 'creator' | 'rarity' | 'activity' | 'bridges' | 'paid' | 'highest' | 'median' | 'floor';
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

function EthCell({ value, rate }: { value: number | null; rate?: number }) {
  if (value == null) return <span className="text-gray-700">—</span>;
  const formatted = value < 0.001 ? value.toFixed(5) : value < 0.01 ? value.toFixed(4) : value.toFixed(3);
  return (
    <span>
      <span className="text-gray-300">{formatted}</span>
      {rate && rate > 0 && (
        <span className="text-gray-600 ml-0.5">(${Math.round(value * rate)})</span>
      )}
    </span>
  );
}

export function DeckHoldingsPanel({
  holdings,
  profiles,
  bridgeIndex,
  creatorCardCounts,
  valuationCards,
  ethUsdRate,
}: DeckHoldingsPanelProps) {
  const [sortKey, setSortKey] = useState<SortKey>('activity');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const valuationMap = useMemo(() => {
    const m = new Map<string, ValuationCard>();
    if (valuationCards) {
      for (const c of valuationCards) {
        m.set(`${c.creator.toLowerCase()}:${c.rarity}`, c);
      }
    }
    return m;
  }, [valuationCards]);

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

  const enriched = useMemo(() => {
    return holdings.map((h) => {
      const lc = h.creator.toLowerCase();
      const bridgeCount = bridgeCounts.get(lc) || 0;
      const activity = creatorCardCounts[lc] ?? creatorCardCounts[h.creator] ?? 0;
      const vc = valuationMap.get(`${lc}:${h.rarity}`);
      return {
        ...h,
        bridgeCount,
        activity,
        lc,
        paid: vc?.purchasePriceEth ?? null,
        paidXeets: vc?.purchasePriceXeets ?? null,
        highest: vc?.highestSaleEth ?? null,
        median: vc?.medianSaleEth ?? null,
        floor: vc?.currentFloorEth ?? null,
      };
    });
  }, [holdings, bridgeCounts, creatorCardCounts, valuationMap]);

  const sorted = useMemo(() => {
    const arr = [...enriched];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'creator': return dir * a.lc.localeCompare(b.lc);
        case 'rarity': return dir * ((RARITY_ORDER[a.rarity] ?? 2) - (RARITY_ORDER[b.rarity] ?? 2));
        case 'activity': return dir * (a.activity - b.activity);
        case 'bridges': return dir * (a.bridgeCount - b.bridgeCount);
        case 'paid': return dir * ((a.paid ?? -1) - (b.paid ?? -1));
        case 'highest': return dir * ((a.highest ?? -1) - (b.highest ?? -1));
        case 'median': return dir * ((a.median ?? -1) - (b.median ?? -1));
        case 'floor': return dir * ((a.floor ?? -1) - (b.floor ?? -1));
        default: return 0;
      }
    });
    return arr;
  }, [enriched, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'creator' ? 'asc' : 'desc');
    }
  };

  const arrow = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const TH = ({ k, title, label, w }: { k: SortKey; title: string; label: string; w?: string }) => (
    <th
      className={`px-1.5 py-1.5 text-right cursor-pointer hover:text-gray-400 transition-colors whitespace-nowrap ${w || ''}`}
      onClick={() => toggleSort(k)}
      title={title}
    >
      {label}{arrow(k)}
    </th>
  );

  return (
    <div className="max-h-[500px] overflow-y-auto overflow-x-auto">
      <table className="w-full text-[10px]" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '140px' }} />  {/* Creator */}
          <col style={{ width: '24px' }} />   {/* R */}
          <col style={{ width: '40px' }} />   {/* Activity */}
          <col style={{ width: '48px' }} />   {/* Bridges */}
          <col style={{ width: '72px' }} />   {/* Paid */}
          <col style={{ width: '72px' }} />   {/* Highest */}
          <col style={{ width: '72px' }} />   {/* Avg */}
          <col style={{ width: '72px' }} />   {/* Floor */}
        </colgroup>
        <thead className="sticky top-0 bg-[rgba(20,20,20,0.98)] z-10">
          <tr className="text-[8px] uppercase tracking-wider text-gray-600">
            <th
              className="px-1.5 py-1.5 text-left cursor-pointer hover:text-gray-400 transition-colors"
              onClick={() => toggleSort('creator')}
            >
              Creator{arrow('creator')}
            </th>
            <th
              className="px-0.5 py-1.5 text-center cursor-pointer hover:text-gray-400 transition-colors"
              onClick={() => toggleSort('rarity')}
              title="Rarity"
            >
              R{arrow('rarity')}
            </th>
            <TH k="activity" title="Cards this creator holds (their activity)" label="Act" />
            <TH k="bridges" title="Secondary creators this card bridges to" label="Bridge" />
            <TH k="paid" title="Your purchase price (ETH)" label="Paid" />
            <TH k="highest" title="Highest OS sale for this card" label="High" />
            <TH k="median" title="Median OS sale price" label="Med" />
            <TH k="floor" title="Current OS floor listing" label="Floor" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((h) => {
            const lowActivity = h.activity < 10;
            return (
              <tr
                key={`${h.creator}-${h.rarity}`}
                className={`border-b border-white/[0.03] ${lowActivity ? 'bg-red-500/[0.04]' : ''}`}
              >
                <td className="px-1.5 py-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <SmallAvatar handle={h.creator} />
                    <span className="text-gray-300 truncate text-[10px]">{h.creator}</span>
                    {h.quantity > 1 && (
                      <span className="text-gray-600 text-[8px] shrink-0">×{h.quantity}</span>
                    )}
                  </div>
                </td>
                <td className="px-0.5 py-1 text-center">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: RARITY_COLORS[h.rarity] || RARITY_COLORS.common }}
                  />
                </td>
                <td className={`px-1.5 py-1 text-right font-mono ${lowActivity ? 'text-red-400/70' : 'text-gray-500'}`}>
                  {h.activity}
                </td>
                <td className={`px-1.5 py-1 text-right font-mono ${
                  h.bridgeCount > 50 ? 'text-[#378ADD] font-semibold' : h.bridgeCount > 0 ? 'text-gray-300' : 'text-gray-600'
                }`}>
                  {h.bridgeCount}
                </td>
                <td className="px-1.5 py-1 text-right font-mono text-[9px]">
                  {h.paid != null ? (
                    <span className="text-[#D85A30]">{h.paid < 0.01 ? h.paid.toFixed(4) : h.paid.toFixed(3)}</span>
                  ) : h.paidXeets != null ? (
                    <span className="text-gray-500">{Math.round(h.paidXeets)}x</span>
                  ) : (
                    <span className="text-gray-700">—</span>
                  )}
                </td>
                <td className="px-1.5 py-1 text-right font-mono text-[9px]">
                  <EthCell value={h.highest} />
                </td>
                <td className="px-1.5 py-1 text-right font-mono text-[9px]">
                  <EthCell value={h.median} />
                </td>
                <td className="px-1.5 py-1 text-right font-mono text-[9px]">
                  <EthCell value={h.floor} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
