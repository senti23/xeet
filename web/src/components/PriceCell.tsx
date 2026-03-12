'use client';

interface PriceCellProps {
  value: number | null;
  currency: string;
  isUsd?: boolean;
}

export function PriceCell({ value, currency, isUsd }: PriceCellProps) {
  if (value === null) {
    return <span className="text-gray-600">N/A</span>;
  }

  const formatted = isUsd
    ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : currency === 'ETH'
      ? `${value.toFixed(6)} ETH`
      : `${value.toLocaleString()} XEETS`;

  return <span className="font-mono text-sm">{formatted}</span>;
}

interface ListingCountProps {
  count: number;
}

export function ListingCount({ count }: ListingCountProps) {
  if (count === 0) {
    return <span className="text-gray-600">0</span>;
  }
  return <span className="text-gray-300 text-xs">{count}</span>;
}
