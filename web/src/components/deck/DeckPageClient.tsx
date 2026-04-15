'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type {
  DeckScoresData,
  CreatorProfiles,
  WalletScoreSummary,
  WalletScoreDetail,
  ValuationResponse,
} from '@/types/deck';
import type { CreatorScore } from '@/types/xccScores';
import { DeckScoreCard } from './DeckScoreCard';
import { DeckLeaderboard } from './DeckLeaderboard';
import { DeckStrengthLeaderboard } from './DeckStrengthLeaderboard';
import { DeckRings } from './DeckRings';
import { DeckGraph } from './DeckGraph';
import { DeckCreatorDetail } from './DeckCreatorDetail';
import { DeckDetailsCard } from './DeckDetailsCard';
import { DeckBucketSummary } from './DeckBucketSummary';
import { DeckShareCard } from './DeckShareCard';
import { FlexDeckModal } from './FlexDeckModal';
import { CollapsiblePanel } from './CollapsiblePanel';
import { DeckMissingPanel } from './DeckMissingPanel';
import { DeckMissingByScore } from './DeckMissingByScore';
import { DeckCredits } from './DeckCredits';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface FloorPricesData {
  generated: string;
  ethUsdRate: number;
  prices: Record<
    string,
    {
      common?: { xeetFloor: number | null; osFloor: number | null } | null;
      rare?: { xeetFloor: number | null; osFloor: number | null } | null;
      legendary?: { xeetFloor: number | null; osFloor: number | null } | null;
    }
  >;
}

function sizeBucket(n: number): { label: string; min: number; max: number } {
  if (n <= 30) return { label: 'small', min: 0, max: 30 };
  if (n <= 80) return { label: 'medium', min: 31, max: 80 };
  if (n <= 150) return { label: 'large', min: 81, max: 150 };
  return { label: 'whale', min: 151, max: Infinity };
}

interface DeckPageClientProps {
  mode?: 'tracker' | 'reach';
}

export function DeckPageClient({ mode = 'tracker' }: DeckPageClientProps) {
  // ─── Router / URL sync ────────────────────────────────────────────────────
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlWallet = searchParams.get('wallet');

  // ─── Data state ───────────────────────────────────────────────────────────
  const [scores, setScores] = useState<DeckScoresData | null>(null);
  const [profiles, setProfiles] = useState<CreatorProfiles | null>(null);
  const [xccScores, setXccScores] = useState<CreatorScore[]>([]);
  const [floorPrices, setFloorPrices] = useState<FloorPricesData | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, WalletScoreDetail> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ─── Search state ─────────────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [activeWallet, setActiveWallet] = useState<string | null>(null);
  const [walletData, setWalletData] = useState<WalletScoreSummary | null>(null);
  const [walletDetail, setWalletDetail] = useState<WalletScoreDetail | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [valuation, setValuation] = useState<ValuationResponse | null>(null);

  // ─── UI state ─────────────────────────────────────────────────────────────
  const [showShare, setShowShare] = useState(false);
  const [showMobileLeaderboard, setShowMobileLeaderboard] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [clickedCreator, setClickedCreator] = useState<
    { handle: string; x: number; y: number } | null
  >(null);
  const [openPanel, setOpenPanel] = useState<string | null>(null);

  const handleToWallet = useRef<Map<string, string>>(new Map());

  // ─── Helper: fetch from API first, fall back to static file ───────────────
  const fetchWithFallback = async (apiPath: string, staticPath: string) => {
    try {
      const res = await fetch(`${API_BASE}${apiPath}`);
      if (res.ok) return res.json();
    } catch {}
    return fetch(staticPath).then((r) => r.json());
  };

  // ─── Load main data on mount ──────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetchWithFallback('/api/deck/scores', '/data/deck-scores.json'),
      fetchWithFallback('/api/deck/profiles', '/data/creators-profiles.json'),
      fetch('/data/xcc-scores.json').then((r) => r.json()),
      fetchWithFallback('/api/deck/floor-prices', '/data/floor-prices.json').catch(() => null),
    ])
      .then(([scoresData, profilesData, xccData, floorsData]) => {
        setScores(scoresData);
        setProfiles(profilesData);
        setXccScores(xccData);
        if (floorsData) setFloorPrices(floorsData);

        const map = new Map<string, string>();
        for (const [wallet, summary] of Object.entries(scoresData.wallets)) {
          const s = summary as WalletScoreSummary;
          if (s.xHandle) {
            map.set(s.xHandle.toLowerCase(), wallet);
          }
        }
        handleToWallet.current = map;
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load score data');
        setLoading(false);
      });

    fetch(`${API_BASE}/api/deck/status`)
      .then((r) => r.json())
      .then((d) => {
        if (d.lastRefresh) setLastUpdated(d.lastRefresh);
      })
      .catch(() => {});

    // Tracker mode needs all wallets' holdings for the strength leaderboard
    if (mode === 'tracker') {
      fetchWithFallback('/api/deck/scores/detail', '/data/deck-scores-detail.json')
        .then((d) => setDetailCache(d))
        .catch(() => {});
    }
  }, [mode]);

  // ─── Lazy-load detail ─────────────────────────────────────────────────────
  const loadDetail = useCallback(async () => {
    if (detailCache) return detailCache;
    const data = await fetchWithFallback(
      '/api/deck/scores/detail',
      '/data/deck-scores-detail.json',
    );
    setDetailCache(data);
    return data as Record<string, WalletScoreDetail>;
  }, [detailCache]);

  // ─── Search ───────────────────────────────────────────────────────────────
  const handleSearch = useCallback(
    async (input: string, opts: { skipUrlUpdate?: boolean } = {}) => {
      if (!scores) return;

      const query = input.trim().toLowerCase();
      if (!query) {
        setActiveWallet(null);
        setWalletData(null);
        setWalletDetail(null);
        setSearchError(null);
        setValuation(null);
        setClickedCreator(null);
        if (!opts.skipUrlUpdate) router.replace(pathname);
        return;
      }

      let wallet = query.startsWith('0x') ? query : null;
      if (!wallet) {
        const cleaned = query.startsWith('@') ? query.slice(1) : query;
        wallet = handleToWallet.current.get(cleaned) ?? null;
      }

      if (!wallet || !scores.wallets[wallet]) {
        setSearchError('Wallet not found in the dataset');
        setActiveWallet(null);
        setWalletData(null);
        setWalletDetail(null);
        return;
      }

      setSearchError(null);
      setActiveWallet(wallet);
      setWalletData(scores.wallets[wallet]);
      setClickedCreator(null);
      if (!opts.skipUrlUpdate) {
        router.replace(`${pathname}?wallet=${wallet}`);
      }

      try {
        const detail = await loadDetail();
        setWalletDetail(detail[wallet] ?? null);
      } catch {
        // Detail is optional
      }

      setValuation(null);
      fetch(`${API_BASE}/api/deck/valuation?wallet=${wallet}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(setValuation)
        .catch(() => setValuation(null));
    },
    [scores, loadDetail, router, pathname],
  );

  // ─── Auto-restore wallet from URL once data is ready ──────────────────────
  const autoRestoredRef = useRef(false);
  useEffect(() => {
    if (!scores || autoRestoredRef.current) return;
    if (urlWallet && urlWallet !== activeWallet) {
      autoRestoredRef.current = true;
      const summary = scores.wallets[urlWallet.toLowerCase()];
      const display = summary?.xHandle ? `@${summary.xHandle}` : urlWallet;
      setSearchInput(display);
      handleSearch(urlWallet, { skipUrlUpdate: true });
    } else if (!urlWallet) {
      autoRestoredRef.current = true;
    }
  }, [scores, urlWallet, activeWallet, handleSearch]);

  // ─── Leaderboard click ────────────────────────────────────────────────────
  const selectWallet = useCallback(
    (wallet: string) => {
      const summary = scores?.wallets[wallet];
      const display = summary?.xHandle ? `@${summary.xHandle}` : wallet;
      setSearchInput(display);
      handleSearch(wallet);
    },
    [scores, handleSearch],
  );

  // ─── Creator click (from rings) ───────────────────────────────────────────
  const handleCreatorClick = useCallback((handle: string, x: number, y: number) => {
    setClickedCreator((prev) =>
      prev && prev.handle === handle ? null : { handle, x, y },
    );
  }, []);

  // ─── Bucket rank for share card ───────────────────────────────────────────
  const bucketRank = useMemo(() => {
    if (!walletData || !scores) return null;
    const bucket = sizeBucket(walletData.directCount);
    const bucketWallets: Array<{ wallet: string; score: number; direct: number }> = [];
    for (const [w, s] of Object.entries(scores.wallets)) {
      const ws = s as WalletScoreSummary;
      if (ws.directCount >= bucket.min && ws.directCount <= bucket.max) {
        bucketWallets.push({ wallet: w, score: ws.score, direct: ws.directCount });
      }
    }
    bucketWallets.sort((a, b) => b.score - a.score);
    const myIdx = bucketWallets.findIndex((b) => b.wallet === activeWallet);
    if (myIdx < 0) return null;
    return {
      rank: myIdx + 1,
      bucketSize: bucketWallets.length,
      bucketLabel: bucket.label,
    };
  }, [walletData, scores, activeWallet]);

  // ─── Lookup creator by handle (for detail popup) ──────────────────────────
  const creatorByHandle = useMemo(() => {
    const m = new Map<string, CreatorScore>();
    for (const c of xccScores) m.set(c.xHandle.toLowerCase(), c);
    return m;
  }, [xccScores]);

  const clickedCreatorScore = clickedCreator
    ? creatorByHandle.get(clickedCreator.handle) ?? null
    : null;

  // ─── Relative time ────────────────────────────────────────────────────────
  const updatedAgo = lastUpdated
    ? (() => {
        const mins = Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 60000);
        if (mins < 1) return 'just now';
        if (mins === 1) return '1 min ago';
        if (mins < 60) return `${mins} min ago`;
        return `${Math.floor(mins / 60)}h ago`;
      })()
    : null;

  // ─── Loading / error ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500">Loading deck scores...</div>
      </div>
    );
  }

  if (error || !scores) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-[#D85A30]">{error ?? 'Failed to load data'}</div>
      </div>
    );
  }

  const missingCount = walletData ? scores.totalCreators - walletData.totalReach : null;

  return (
    <div className="space-y-4">
      {/* Credits (top right, desktop only) */}
      <div className="flex items-start justify-between">
        <div />
        <DeckCredits />
      </div>

      {/* Top bar: search + updated + share */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch(searchInput);
            }}
            placeholder="Paste wallet address or enter @handle..."
            className="w-full rounded-xl border border-white/[0.08] bg-[rgba(20,20,20,0.9)] px-4 py-3 text-sm text-gray-100 placeholder-gray-600 outline-none transition-colors focus:border-[#E53935] font-mono"
          />
          <button
            onClick={() => handleSearch(searchInput)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-[#E53935]/20 px-4 py-1.5 text-sm font-medium text-[#E53935] transition-colors hover:bg-[#E53935]/30"
          >
            Search
          </button>
        </div>
        {walletData && (mode === 'reach' || walletDetail) && (
          <button
            onClick={() => setShowShare(true)}
            className="shrink-0 rounded-xl bg-[#E53935] px-4 py-3 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          >
            📸 Share
          </button>
        )}
        {updatedAgo && (
          <div className="hidden md:block shrink-0 rounded-lg bg-white/[0.04] px-3 py-1.5 text-[10px] text-gray-500 font-mono">
            Updated {updatedAgo}
          </div>
        )}
      </div>

      {searchError && (
        <div className="rounded-xl border border-[#D85A30]/30 bg-[#D85A30]/10 px-4 py-3 text-sm text-[#D85A30]">
          {searchError}
        </div>
      )}

      {/* Main content — single column, centered, rings are the hero */}
      <div className="max-w-[1200px] mx-auto space-y-4">
        {/* Reach-only: Score card (99.7% / Direct / Secondary / Total / Overall + XCC rank) */}
        {mode === 'reach' && walletData && activeWallet && (
          <DeckScoreCard
            wallet={walletData}
            address={activeWallet}
            totalCreators={scores.totalCreators}
            valuation={valuation}
          />
        )}

        {/* Tracker-only: Deck details card above the rings */}
        {mode === 'tracker' && walletData && walletDetail && activeWallet && (
          <DeckDetailsCard
            walletData={walletData}
            walletDetail={walletDetail}
            xccScores={xccScores}
            detailCache={detailCache}
            activeWallet={activeWallet}
          />
        )}

        {/* Visualization (the hero) — rings for tracker, force-directed graph for reach */}
        <div className="relative rounded-2xl border border-white/[0.06] bg-[rgba(10,10,10,0.9)] p-2">
          {mode === 'tracker' ? (
            <DeckRings
              xccScores={xccScores}
              walletDetail={walletDetail}
              walletPfpHandle={walletData?.xHandle || null}
              onCreatorClick={handleCreatorClick}
            />
          ) : (
            <DeckGraph
              walletData={walletData}
              detail={walletDetail}
              profiles={profiles}
            />
          )}

          {/* Creator detail flip-card popup — tracker only (reach uses in-graph fan-out) */}
          {mode === 'tracker' && clickedCreatorScore && clickedCreator && (
            <DeckCreatorDetail
              creator={clickedCreatorScore}
              x={clickedCreator.x}
              y={clickedCreator.y}
              walletDetail={walletDetail}
              floorPrices={floorPrices}
              onClose={() => setClickedCreator(null)}
            />
          )}
        </div>

        {/* Leaderboard button — centered under rings */}
        <div className="flex justify-center">
          <button
            onClick={() => setShowMobileLeaderboard(true)}
            className="rounded-xl border border-white/[0.08] bg-[rgba(20,20,20,0.9)] px-5 py-2.5 text-sm font-semibold text-gray-200 hover:bg-white/[0.06] transition-colors"
          >
            🏆 {mode === 'tracker' ? 'Deck Strength Leaderboard' : 'Reach Leaderboard'}
          </button>
        </div>

        {/* Wallet-category breakdown — both pages, bottom.
            Bucketing is by TOTAL CARDS held (sum of quantities). */}
        <DeckBucketSummary
          scores={scores}
          detailCache={detailCache}
          activeTotalCards={
            walletDetail
              ? walletDetail.direct.reduce((s, h) => s + h.quantity, 0)
              : null
          }
          activeDirectCount={walletData?.directCount ?? null}
        />

        {/* Missing panel — content depends on mode */}
        {walletData && mode === 'tracker' && (
          <CollapsiblePanel
            title="Missing Creators"
            badge={walletDetail ? (xccScores.length - walletDetail.direct.length) : undefined}
            badgeColor="#D85A30"
            isOpen={openPanel === 'missing'}
            onToggle={() =>
              setOpenPanel((prev) => (prev === 'missing' ? null : 'missing'))
            }
          >
            <DeckMissingByScore
              xccScores={xccScores}
              walletDetail={walletDetail}
              onCreatorClick={(handle) => {
                setClickedCreator({ handle, x: 400, y: 400 });
                setOpenPanel(null);
              }}
            />
          </CollapsiblePanel>
        )}

        {walletData && mode === 'reach' && (
          <CollapsiblePanel
            title="Missing Creators (Bridges & Cheapest Picks)"
            badge={missingCount ?? undefined}
            badgeColor="#D85A30"
            isOpen={openPanel === 'missing'}
            onToggle={() =>
              setOpenPanel((prev) => (prev === 'missing' ? null : 'missing'))
            }
          >
            {activeWallet ? (
              <DeckMissingPanel wallet={activeWallet} />
            ) : (
              <div className="py-4 text-center text-xs text-gray-600">
                Search a wallet first
              </div>
            )}
          </CollapsiblePanel>
        )}
      </div>

      {/* Leaderboard modal — unified for all screens */}
      {showMobileLeaderboard && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setShowMobileLeaderboard(false)}
          />
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-[480px] max-h-[85vh] overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0a0a0a] shadow-2xl"
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-white/[0.06] bg-[#0a0a0a] px-4 py-3 z-10">
              <span className="text-sm font-semibold text-white">
                🏆 {mode === 'tracker' ? 'Deck Strength' : 'Reach'} Leaderboard
              </span>
              <button
                onClick={() => setShowMobileLeaderboard(false)}
                className="text-gray-500 hover:text-white text-lg"
              >
                ✕
              </button>
            </div>
            <div className="p-3">
              {mode === 'tracker' ? (
                <DeckStrengthLeaderboard
                  wallets={scores.wallets}
                  detail={detailCache}
                  xccScores={xccScores}
                  profiles={profiles}
                  highlightWallet={activeWallet}
                  onSelectWallet={(wallet) => {
                    selectWallet(wallet);
                    setShowMobileLeaderboard(false);
                  }}
                />
              ) : (
                <DeckLeaderboard
                  leaderboard={scores.leaderboard}
                  highlightWallet={activeWallet}
                  profiles={profiles}
                  onSelectWallet={(wallet) => {
                    selectWallet(wallet);
                    setShowMobileLeaderboard(false);
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-xs text-gray-600">
        {scores.totalWallets.toLocaleString()} wallets scored across {scores.totalCreators} creators
        <span className="mx-2">·</span>
        Data generated {new Date(scores.generated).toLocaleDateString()}
      </div>

      {/* Share modal — reach-focused on /reach, strength-focused on /deck */}
      {showShare && walletData && walletDetail && mode === 'tracker' && (
        <DeckShareCard
          wallet={walletData}
          walletDetail={walletDetail}
          xccScores={xccScores}
          bucketRank={bucketRank}
          onClose={() => setShowShare(false)}
        />
      )}
      {showShare && walletData && mode === 'reach' && (
        <FlexDeckModal
          wallet={walletData}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  );
}
