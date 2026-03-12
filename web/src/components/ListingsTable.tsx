'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CreatorRarityData, ListingsResponse } from '../lib/api';
import { PriceCell, ListingCount } from './PriceCell';
import { FilterBar } from './FilterBar';
import { RefreshIndicator } from './RefreshIndicator';

interface ListingsTableProps {
  initialData: ListingsResponse;
}

const RARITY_COLORS: Record<string, string> = {
  common: 'text-gray-400',
  rare: 'text-blue-400',
  legendary: 'text-yellow-400',
};

export function ListingsTable({ initialData }: ListingsTableProps) {
  const [data, setData] = useState<CreatorRarityData[]>(initialData.data);
  const [meta, setMeta] = useState(initialData.meta);
  const [search, setSearch] = useState('');
  const [rarity, setRarity] = useState('');
  const [sort, setSort] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');

  const refresh = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (rarity) params.set('rarity', rarity);
      if (sort) params.set('sort', sort);
      if (order) params.set('order', order);
      params.set('limit', '500');

      const res = await fetch(`/api/listings?${params}`);
      if (!res.ok) return;
      const json: ListingsResponse = await res.json();
      setData(json.data);
      setMeta(json.meta);
    } catch {
      // silent retry on next interval
    }
  }, [search, rarity, sort, order]);

  // Auto-refresh every 60s
  useEffect(() => {
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Refresh on filter change
  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <FilterBar
          search={search} onSearchChange={setSearch}
          rarity={rarity} onRarityChange={setRarity}
          sort={sort} onSortChange={setSort}
          order={order} onOrderChange={setOrder}
        />
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-500">{meta.total} entries</span>
          <RefreshIndicator lastUpdated={meta.lastUpdated} />
          {meta.ethUsdRate > 0 && (
            <span className="text-xs text-gray-500">ETH/USD: ${meta.ethUsdRate.toLocaleString()}</span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 sticky top-0">
            <tr className="text-left text-gray-400 text-xs uppercase tracking-wider">
              <th className="px-4 py-3">Creator</th>
              <th className="px-4 py-3">Rarity</th>
              <th className="px-4 py-3 text-right">Xeet Floor</th>
              <th className="px-4 py-3 text-center">#</th>
              <th className="px-4 py-3 text-right">OS Floor</th>
              <th className="px-4 py-3 text-center">#</th>
              <th className="px-4 py-3 text-right">USD Est.</th>
              <th className="px-4 py-3 text-right">Best Offer</th>
              <th className="px-4 py-3 text-right">Last Sale (Xeet)</th>
              <th className="px-4 py-3 text-right">Last Sale (OS)</th>
              <th className="px-4 py-3 text-right">Expiry</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {data.map((row) => (
              <tr
                key={`${row.creator}:${row.rarity}`}
                className="hover:bg-gray-900/50 transition-colors"
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium">{row.displayName}</div>
                  <div className="text-gray-500 text-xs">@{row.creator}</div>
                </td>
                <td className={`px-4 py-2.5 ${RARITY_COLORS[row.rarity] || ''} capitalize text-xs font-semibold`}>
                  {row.rarity}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <PriceCell value={row.xeetFloor} currency="XEETS" />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <ListingCount count={row.xeetListingCount} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <PriceCell value={row.osFloor} currency="ETH" />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <ListingCount count={row.osListingCount} />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <PriceCell value={row.usdEstimate} currency="USD" isUsd />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <PriceCell value={row.bestOffer} currency="ETH" />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <PriceCell value={row.lastSaleXeet} currency="XEETS" />
                </td>
                <td className="px-4 py-2.5 text-right">
                  <PriceCell value={row.lastSaleOs} currency="ETH" />
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-gray-500">
                  {row.osFloorExpiry
                    ? new Date(row.osFloorExpiry).toLocaleDateString()
                    : <span className="text-gray-700">—</span>}
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-gray-500">
                  No data available. Server may still be loading...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
