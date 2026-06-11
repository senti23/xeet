'use client';

import { useState, useEffect, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const RARITY_COLORS: Record<string, string> = {
  legendary: '#D85A30',
  rare: '#378ADD',
  common: '#888780',
};

// ─── Types (mirrors API response) ───────────────────────────────────────────

interface CoveredCreator {
  handle: string;
  displayName: string;
  avatar: string;
}

interface BestPick {
  xccHandle: string;
  xccDisplayName: string;
  xccAvatar: string;
  cheapestRarity: string;
  tokenId: string | null;
  xeetFloor: number | null;
  osFloor: number | null;
  usdEstimate: number | null;
  missingCreatorsCovered: CoveredCreator[];
  coverageCount: number;
}

interface BridgeOption {
  xccHandle: string;
  xccDisplayName: string;
  xccAvatar: string;
  cheapestRarity: string;
  tokenId: string | null;
  xeetFloor: number | null;
  osFloor: number | null;
  usdEstimate: number | null;
  otherMissingCovered: number;
}

interface RemainingCreator {
  handle: string;
  displayName: string;
  avatar: string;
  unreachable: boolean;
  options: BridgeOption[];
}

interface MissingData {
  missingCount: number;
  totalCreators: number;
  reachable: number;
  bestPicks: BestPick[];
  remaining: RemainingCreator[];
  holdersAsOf: string | null;
  pricesAsOf: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const OS_CONTRACT = '0xce8cb6676f6cfb3161a72a723b436987c6cf4e68';

function PriceLinks({
  xeetFloor,
  osFloor,
  tokenId,
}: {
  xeetFloor: number | null;
  osFloor: number | null;
  tokenId: string | null;
}) {
  const hasXeet = xeetFloor != null && xeetFloor > 0;
  const hasOs = osFloor != null && osFloor > 0;

  if (!hasXeet && !hasOs) return <span className="text-gray-600">No listing</span>;

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {hasXeet && (
        <a
          href="https://www.xeet.ai/market/trade"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 hover:underline"
        >
          {xeetFloor!.toLocaleString()} XEETS
          <span className="opacity-60 hover:opacity-100 transition-opacity">↗</span>
        </a>
      )}
      {hasXeet && hasOs && <span className="text-gray-600">·</span>}
      {hasOs && tokenId && (
        <a
          href={`https://opensea.io/assets/megaeth/${OS_CONTRACT}/${tokenId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 hover:underline"
        >
          {osFloor!.toFixed(4)} ETH
          <span className="opacity-60 hover:opacity-100 transition-opacity">↗</span>
        </a>
      )}
      {hasOs && !tokenId && (
        <span>{osFloor!.toFixed(4)} ETH</span>
      )}
    </span>
  );
}

function SmallAvatar({ src, name, size = 16 }: { src: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="shrink-0 flex items-center justify-center rounded-full bg-gray-800 text-gray-500"
        style={{ width: size, height: size, fontSize: size * 0.45 }}
      >
        {name[0]?.toUpperCase() || '?'}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="shrink-0 rounded-full object-cover bg-gray-800"
      style={{ width: size, height: size }}
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

// ─── Skeleton ───────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg bg-white/[0.04] p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-white/[0.08]" />
            <div className="h-3 w-24 rounded bg-white/[0.08]" />
          </div>
          <div className="h-2 w-16 rounded bg-white/[0.06]" />
        </div>
      ))}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

interface DeckMissingPanelProps {
  wallet: string;
}

export function DeckMissingPanel({ wallet }: DeckMissingPanelProps) {
  const [data, setData] = useState<MissingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRemaining, setExpandedRemaining] = useState<string | null>(null);

  const fetchMissing = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/deck/missing?wallet=${wallet}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    fetchMissing();
  }, [fetchMissing]);

  // ─── Loading ────────────────────────────────────────────────────────────
  if (loading) return <Skeleton />;

  // ─── Error ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="text-center py-3">
        <p className="text-xs text-[#D85A30] mb-2">{error}</p>
        <button
          onClick={fetchMissing}
          className="text-[10px] px-3 py-1 rounded bg-white/[0.06] text-gray-400 hover:text-white transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  // ─── Full coverage ──────────────────────────────────────────────────────
  if (data.missingCount === 0) {
    return (
      <div className="rounded-lg bg-green-500/10 border border-green-500/20 px-3 py-3 text-center">
        <div className="text-sm font-medium text-green-400">Full Coverage</div>
        <div className="text-[10px] text-green-400/70 mt-0.5">
          You can reach all {data.totalCreators} creators
        </div>
      </div>
    );
  }

  // ─── Best picks + remaining ─────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Best picks */}
      {data.bestPicks.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold mb-2">
            Best picks to improve your reach
          </div>
          <div className="space-y-2">
            {data.bestPicks.map((pick, i) => (
              <div
                key={pick.xccHandle}
                className="rounded-lg bg-white/[0.03] border-l-[3px] p-2.5"
                style={{ borderLeftColor: RARITY_COLORS[pick.cheapestRarity] || RARITY_COLORS.common }}
              >
                {/* Header: rank + pfp + name + rarity + price */}
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] text-gray-600 font-mono w-4">#{i + 1}</span>
                  <SmallAvatar src={pick.xccAvatar} name={pick.xccDisplayName} size={22} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-gray-200 truncate">
                        {pick.xccDisplayName}
                      </span>
                      <RarityDot rarity={pick.cheapestRarity} />
                    </div>
                    <div className="text-[10px] text-gray-500">
                      <PriceLinks xeetFloor={pick.xeetFloor} osFloor={pick.osFloor} tokenId={pick.tokenId} />
                    </div>
                  </div>
                </div>

                {/* Covered creators */}
                <div className="flex items-center gap-1 flex-wrap mt-1">
                  <span className="text-[9px] text-gray-600">Covers:</span>
                  {pick.missingCreatorsCovered.map((c) => (
                    <div key={c.handle} className="flex items-center gap-0.5">
                      <SmallAvatar src={c.avatar} name={c.displayName} size={14} />
                      <span className="text-[10px] text-gray-400">{c.displayName}</span>
                    </div>
                  ))}
                </div>
                <div className="text-[9px] text-gray-600 mt-1">
                  ({pick.coverageCount} creator{pick.coverageCount > 1 ? 's' : ''} gained)
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Remaining */}
      {data.remaining.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-widest text-gray-600 font-semibold mb-2">
            Remaining ({data.remaining.length} creator{data.remaining.length > 1 ? 's' : ''})
          </div>
          <div className="space-y-0.5">
            {data.remaining.map((r) => (
              <div key={r.handle}>
                {/* Row */}
                <button
                  onClick={() => {
                    if (r.unreachable) return;
                    setExpandedRemaining((prev) => (prev === r.handle ? null : r.handle));
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors ${
                    r.unreachable ? 'opacity-60 cursor-default' : 'hover:bg-white/[0.03] cursor-pointer'
                  }`}
                >
                  <SmallAvatar src={r.avatar} name={r.displayName} size={20} />
                  <span className="text-xs text-gray-300 flex-1 truncate">{r.displayName}</span>
                  {r.unreachable ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#D85A30]/15 text-[#D85A30] shrink-0">
                      unreachable
                    </span>
                  ) : (
                    <span
                      className="text-[10px] text-gray-600 transition-transform duration-150"
                      style={{
                        transform: expandedRemaining === r.handle ? 'rotate(90deg)' : 'rotate(0deg)',
                      }}
                    >
                      ▶
                    </span>
                  )}
                </button>

                {/* Expanded options */}
                {expandedRemaining === r.handle && !r.unreachable && r.options.length > 0 && (
                  <div className="ml-7 mb-2 space-y-1">
                    {r.options.map((opt) => (
                      <div
                        key={opt.xccHandle}
                        className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/[0.02] text-[10px]"
                      >
                        <SmallAvatar src={opt.xccAvatar} name={opt.xccDisplayName} size={16} />
                        <span className="text-gray-400 truncate">{opt.xccDisplayName}</span>
                        <RarityDot rarity={opt.cheapestRarity} />
                        <span className="text-gray-500 ml-auto shrink-0">
                          <PriceLinks xeetFloor={opt.xeetFloor} osFloor={opt.osFloor} tokenId={opt.tokenId} />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
