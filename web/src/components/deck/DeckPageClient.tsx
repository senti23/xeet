'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  DeckScoresData,
  CreatorProfiles,
  WalletScoreSummary,
  WalletScoreDetail,
  ValuationResponse,
} from '@/types/deck';
import { DeckScoreCard } from './DeckScoreCard';
import { DeckLeaderboard } from './DeckLeaderboard';
import { DeckGraph } from './DeckGraph';
import { FlexDeckModal } from './FlexDeckModal';
import { CollapsiblePanel } from './CollapsiblePanel';
import { DeckMissingPanel } from './DeckMissingPanel';
import { DeckHoldingsPanel } from './DeckHoldingsPanel';
import { DeckUpgradesPanel } from './DeckUpgradesPanel';
import { DeckCredits } from './DeckCredits';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function DeckPageClient() {
  // ─── Data state ───────────────────────────────────────────────────────────
  const [scores, setScores] = useState<DeckScoresData | null>(null);
  const [profiles, setProfiles] = useState<CreatorProfiles | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, WalletScoreDetail> | null>(null);
  const [creatorCardCounts, setCreatorCardCounts] = useState<Record<string, number>>({});
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
  const [showFlex, setShowFlex] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showMobileLeaderboard, setShowMobileLeaderboard] = useState(false);
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

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
      fetchWithFallback('/api/deck/holdings', '/data/creator-holdings.json').catch(() => null),
    ])
      .then(([scoresData, profilesData, holdingsData]) => {
        setScores(scoresData);
        setProfiles(profilesData);

        if (holdingsData) {
          const counts: Record<string, number> = {};
          for (const [handle, data] of Object.entries(holdingsData)) {
            const d = data as { holds?: Array<unknown> };
            counts[handle.toLowerCase()] = d.holds?.length ?? 0;
          }
          setCreatorCardCounts(counts);
        }

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
  }, []);

  // ─── Lazy-load detail ─────────────────────────────────────────────────────
  const loadDetail = useCallback(async () => {
    if (detailCache) return detailCache;
    const data = await fetchWithFallback('/api/deck/scores/detail', '/data/deck-scores-detail.json');
    setDetailCache(data);
    return data as Record<string, WalletScoreDetail>;
  }, [detailCache]);

  // ─── Search ───────────────────────────────────────────────────────────────
  const handleSearch = useCallback(
    async (input: string) => {
      if (!scores) return;

      const query = input.trim().toLowerCase();
      if (!query) {
        setActiveWallet(null);
        setWalletData(null);
        setWalletDetail(null);
        setSearchError(null);
        setValuation(null);
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

      try {
        const detail = await loadDetail();
        setWalletDetail(detail[wallet] ?? null);
      } catch {
        // Detail is optional
      }

      // Fetch valuation (non-blocking)
      setValuation(null);
      fetch(`${API_BASE}/api/deck/valuation?wallet=${wallet}`)
        .then((r) => (r.ok ? r.json() : null))
        .then(setValuation)
        .catch(() => setValuation(null));
    },
    [scores, loadDetail],
  );

  // ─── Leaderboard click → load wallet + reset to graph ─────────────────────
  const selectWallet = useCallback(
    (wallet: string) => {
      const summary = scores?.wallets[wallet];
      const display = summary?.xHandle ? `@${summary.xHandle}` : wallet;
      setSearchInput(display);
      setShowAnalytics(false); // Reset to graph view on wallet change
      handleSearch(wallet);
    },
    [scores, handleSearch],
  );

  // ─── Panel toggle ─────────────────────────────────────────────────────────
  const togglePanel = useCallback((name: string) => {
    setOpenPanel((prev) => (prev === name ? null : name));
  }, []);

  // ─── Relative time helper ─────────────────────────────────────────────────
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

  // ─── Badge values ─────────────────────────────────────────────────────────
  const missingCount = walletData ? scores.totalCreators - walletData.totalReach : null;
  const holdingsCount = walletData?.directCount ?? null;

  return (
    <div className="space-y-4">
      {/* ─── Credits (top right, desktop only) ─────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div /> {/* spacer */}
        <DeckCredits />
      </div>

      {/* ─── Top bar: search + status ──────────────────────────────────────── */}
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
        {updatedAgo && (
          <div className="shrink-0 rounded-lg bg-white/[0.04] px-3 py-1.5 text-[10px] text-gray-500 font-mono">
            Updated {updatedAgo}
          </div>
        )}
      </div>

      {searchError && (
        <div className="rounded-xl border border-[#D85A30]/30 bg-[#D85A30]/10 px-4 py-3 text-sm text-[#D85A30]">
          {searchError}
        </div>
      )}

      {/* ─── Main layout: content + right sidebar leaderboard ────────────── */}
      <div className="flex gap-6 items-start">
        {/* MAIN CONTENT */}
        <div className="flex-1 min-w-0">
          {/* Score card + action buttons */}
          {walletData && activeWallet ? (
            <div className="mb-4">
              <DeckScoreCard
                wallet={walletData}
                address={activeWallet}
                totalCreators={scores.totalCreators}
                valuation={valuation}
              />
              <button
                onClick={() => setShowFlex(true)}
                className="mt-3 w-full rounded-lg py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
                style={{ background: '#E53935' }}
              >
                Flex Your Deck
              </button>
              <button
                onClick={() => {
                  setShowAnalytics(!showAnalytics);
                  if (!showAnalytics) setOpenPanel(null);
                }}
                className={`mt-2 w-full rounded-lg py-2.5 text-sm font-semibold transition-all duration-200 ${
                  showAnalytics
                    ? 'border border-[#378ADD]/40 bg-[#378ADD]/15 text-white'
                    : 'border border-[#378ADD]/30 bg-[#378ADD]/10 text-[#378ADD] hover:bg-[#378ADD]/20'
                }`}
              >
                {showAnalytics ? '← Back to Graph' : 'Analytics & Suggestions'}
              </button>
            </div>
          ) : (
            <div className="mb-4 rounded-2xl border border-white/[0.06] bg-[rgba(20,20,20,0.9)] p-6 text-center text-sm text-gray-600">
              Search a wallet to see its stats
            </div>
          )}

          {/* Analytics panels — shown when toggle active */}
          {showAnalytics && walletData && (
            <div className="space-y-3">
              <CollapsiblePanel
                title="Missing"
                badge={missingCount ?? undefined}
                badgeColor="#D85A30"
                isOpen={openPanel === 'missing'}
                onToggle={() => togglePanel('missing')}
              >
                {activeWallet ? (
                  <DeckMissingPanel wallet={activeWallet} />
                ) : (
                  <div className="py-4 text-center text-xs text-gray-600">Search a wallet first</div>
                )}
              </CollapsiblePanel>

              <CollapsiblePanel
                title="Holdings"
                badge={holdingsCount ?? undefined}
                badgeColor="#888780"
                isOpen={openPanel === 'holdings'}
                onToggle={() => togglePanel('holdings')}
              >
                {walletDetail ? (
                  <DeckHoldingsPanel
                    holdings={walletDetail.direct}
                    profiles={profiles}
                    bridgeIndex={walletDetail.secondary}
                    creatorCardCounts={creatorCardCounts}
                    valuationCards={valuation?.cards}
                    ethUsdRate={valuation?.ethUsdRate}
                  />
                ) : (
                  <div className="py-4 text-center text-xs text-gray-600">Loading holdings...</div>
                )}
              </CollapsiblePanel>

              <CollapsiblePanel
                title="Upgrade Opportunities"
                badgeColor="#378ADD"
                isOpen={openPanel === 'upgrades'}
                onToggle={() => togglePanel('upgrades')}
              >
                {activeWallet ? (
                  <DeckUpgradesPanel wallet={activeWallet} />
                ) : (
                  <div className="py-4 text-center text-xs text-gray-600">Search a wallet first</div>
                )}
              </CollapsiblePanel>

              <CollapsiblePanel
                title="Squad Access"
                isOpen={openPanel === 'squad'}
                onToggle={() => togglePanel('squad')}
              >
                <div className="py-8 text-center text-xs text-gray-600">
                  Coming soon — cards ranked by reach per cost
                </div>
              </CollapsiblePanel>
            </div>
          )}

          {/* Graph — hidden via display:none when analytics active, NOT unmounted */}
          <div style={{ display: showAnalytics ? 'none' : 'block' }}>
            <DeckGraph
              walletData={walletData}
              detail={walletDetail}
              profiles={profiles}
            />
          </div>
        </div>

        {/* RIGHT SIDEBAR — Leaderboard (hidden on mobile) */}
        <aside
          className="hidden lg:block w-[380px] shrink-0 overflow-y-auto rounded-2xl border border-white/[0.06] bg-[rgba(20,20,20,0.9)]"
          style={{
            position: 'sticky',
            top: 80,
            maxHeight: 'calc(100vh - 100px)',
          }}
        >
          <div className="p-3">
            <DeckLeaderboard
              leaderboard={scores.leaderboard}
              highlightWallet={activeWallet}
              profiles={profiles}
              onSelectWallet={selectWallet}
            />
          </div>
        </aside>
      </div>

      {/* Mobile leaderboard overlay */}
      {showMobileLeaderboard && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowMobileLeaderboard(false)}
          />
          <div className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-white/[0.08] bg-[#0a0a0a]">
            <div className="sticky top-0 flex items-center justify-between border-b border-white/[0.06] bg-[#0a0a0a] px-4 py-3">
              <span className="text-sm font-semibold text-white">Leaderboard</span>
              <button
                onClick={() => setShowMobileLeaderboard(false)}
                className="text-gray-500 hover:text-white text-lg"
              >
                ✕
              </button>
            </div>
            <div className="p-3">
              <DeckLeaderboard
                leaderboard={scores.leaderboard}
                highlightWallet={activeWallet}
                profiles={profiles}
                onSelectWallet={(wallet) => {
                  selectWallet(wallet);
                  setShowMobileLeaderboard(false);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Mobile leaderboard toggle button */}
      <button
        onClick={() => setShowMobileLeaderboard(true)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-[rgba(20,20,20,0.95)] px-4 py-2.5 text-xs font-semibold text-white shadow-lg border border-white/[0.1] lg:hidden"
      >
        🏆 Leaderboard
      </button>

      {/* Footer stats */}
      <div className="text-center text-xs text-gray-600">
        {scores.totalWallets.toLocaleString()} wallets scored across {scores.totalCreators} creators
        <span className="mx-2">·</span>
        Data generated {new Date(scores.generated).toLocaleDateString()}
      </div>

      {/* Flex Your Deck modal */}
      {showFlex && walletData && (
        <FlexDeckModal wallet={walletData} onClose={() => setShowFlex(false)} />
      )}
    </div>
  );
}
