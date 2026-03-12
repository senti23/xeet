'use client';

interface FilterBarProps {
  search: string;
  onSearchChange: (val: string) => void;
  rarity: string;
  onRarityChange: (val: string) => void;
  sort: string;
  onSortChange: (val: string) => void;
  order: 'asc' | 'desc';
  onOrderChange: (val: 'asc' | 'desc') => void;
}

const RARITIES = [
  { value: '', label: 'All Rarities' },
  { value: 'common', label: 'Common' },
  { value: 'rare', label: 'Rare' },
  { value: 'legendary', label: 'Legendary' },
];

const SORTS = [
  { value: '', label: 'Default' },
  { value: 'creator', label: 'Creator Name' },
  { value: 'xeet_floor', label: 'Xeet Floor' },
  { value: 'os_floor', label: 'OpenSea Floor' },
  { value: 'usd', label: 'USD Estimate' },
  { value: 'best_offer', label: 'Best Offer' },
];

export function FilterBar({
  search, onSearchChange,
  rarity, onRarityChange,
  sort, onSortChange,
  order, onOrderChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap gap-3 items-center mb-4">
      <input
        type="text"
        placeholder="Search creator..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 w-64"
      />

      <select
        value={rarity}
        onChange={(e) => onRarityChange(e.target.value)}
        className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
      >
        {RARITIES.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>

      <select
        value={sort}
        onChange={(e) => onSortChange(e.target.value)}
        className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      <button
        onClick={() => onOrderChange(order === 'asc' ? 'desc' : 'asc')}
        className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm hover:bg-gray-800 transition-colors"
      >
        {order === 'asc' ? '↑ Asc' : '↓ Desc'}
      </button>
    </div>
  );
}
