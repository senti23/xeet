'use client';

import { useState } from 'react';
import type { WalletScoreDetail } from '@/types/deck';
import { type CreatorScore, TIER_COLORS } from '@/types/xccScores';

// ── OpenSea URL builder: collection filtered by creator trait + rarity ──────────
const OS_COLLECTION = 'https://opensea.io/collection/xeet-creator-cards-mega';
function osListingUrl(displayName: string, rarity: 'Common' | 'Rare' | 'Legendary'): string {
  // traits filter: Creator (displayName) AND Rarity — URL-encoded JSON shape used by OS
  const traits = encodeURIComponent(
    JSON.stringify([
      { traitType: 'Creator', values: [displayName] },
      { traitType: 'Rarity', values: [rarity] },
    ]),
  );
  return `${OS_COLLECTION}?traits=${traits}`;
}

interface FloorPricesEntry {
  common?: { xeetFloor: number | null; osFloor: number | null } | null;
  rare?: { xeetFloor: number | null; osFloor: number | null } | null;
  legendary?: { xeetFloor: number | null; osFloor: number | null } | null;
}

interface FloorPricesData {
  prices: Record<string, FloorPricesEntry>;
}

interface DeckCreatorDetailProps {
  creator: CreatorScore;
  x: number;
  y: number;
  walletDetail: WalletScoreDetail | null;
  floorPrices: FloorPricesData | null;
  onClose: () => void;
}

// ── Avatar with fallback ─────────────────────────────────────────────────────────
function CardAvatar({ handle, size }: { handle: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="flex items-center justify-center rounded-full bg-gray-800 text-gray-400"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        {handle[0]?.toUpperCase() || '?'}
      </div>
    );
  }
  return (
    <img
      src={`/avatars/${handle.toLowerCase()}.jpg`}
      alt=""
      className="rounded-full object-cover bg-gray-800"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

// ── Dimension bar (front) ────────────────────────────────────────────────────────
function DimensionBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="text-gray-500 w-[70px] shrink-0">{label}</span>
      <div className="relative flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="absolute top-0 left-0 h-full rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="font-mono text-gray-300 w-6 text-right">{value.toFixed(0)}</span>
    </div>
  );
}

// ── Alchemical / mystical SVG badge icons (back) ─────────────────────────────────
// All render monochrome in currentColor; parent sets color per tier.

function CrownGlyph({ size = 22 }: { size?: number }) {
  // Geometric crown — for bestRank ≤ 3
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M3 18h18M4 18l-1-9 5 4 4-7 4 7 5-4-1 9" />
      <circle cx="12" cy="5" r="1" fill="currentColor" />
      <circle cx="3" cy="9" r="0.8" fill="currentColor" />
      <circle cx="21" cy="9" r="0.8" fill="currentColor" />
    </svg>
  );
}

function OrbitalGlyph({ size = 22 }: { size?: number }) {
  // Orbital diagram — for reach ≥ 90
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(-60 12 12)" />
    </svg>
  );
}

function SignalGlyph({ size = 22 }: { size?: number }) {
  // Signal wave — for performance ≥ 90
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M3 12c1.5-4 3-4 4.5 0S10.5 16 12 12s3-4 4.5 0 3 4 4.5 0" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
    </svg>
  );
}

function TriquetraGlyph({ size = 22 }: { size?: number }) {
  // Alchemical knot — for multiplierBreadth ≥ 3
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="12" cy="9" r="4" />
      <circle cx="8.5" cy="14.5" r="4" />
      <circle cx="15.5" cy="14.5" r="4" />
    </svg>
  );
}

function ApexGlyph({ size = 22 }: { size?: number }) {
  // Mythic sigil — nested triangle + point
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M12 3 L21 20 L3 20 Z" />
      <path d="M12 8 L17 18 L7 18 Z" />
      <circle cx="12" cy="14" r="1" fill="currentColor" />
    </svg>
  );
}

function BalanceGlyph({ size = 22 }: { size?: number }) {
  // Balance scale — for market ≥ 90
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M12 4v16M4 20h16M5 9h6M13 9h6" />
      <path d="M2 13c1 2 5 2 6 0L5 9zM16 13c1 2 5 2 6 0L19 9z" />
    </svg>
  );
}

function SunMoonGlyph({ size = 22 }: { size?: number }) {
  // Ecosystem sigil — sun/moon duality
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" strokeLinecap="round" />
    </svg>
  );
}

// Badge wrapper — hexagonal frame + icon
function Badge({ label, icon, color }: { label: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="relative flex items-center justify-center"
        style={{
          width: 42,
          height: 42,
          color,
          filter: `drop-shadow(0 0 6px ${color}88)`,
        }}
      >
        {/* hex frame */}
        <svg
          width={42}
          height={42}
          viewBox="0 0 42 42"
          className="absolute inset-0"
          fill="none"
          stroke={color}
          strokeWidth="1"
          opacity={0.8}
        >
          <path d="M21 2 L37 11 L37 31 L21 40 L5 31 L5 11 Z" />
        </svg>
        <div className="relative">{icon}</div>
      </div>
      <span
        className="text-[8px] uppercase tracking-wider font-mono"
        style={{ color: `${color}` }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Back grid cell ───────────────────────────────────────────────────────────────
function GridCell({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div
      className="relative rounded border px-2 py-1.5 overflow-hidden"
      style={{ borderColor: `${color}30`, background: `${color}08` }}
    >
      <div
        className="text-[8px] uppercase tracking-widest font-mono opacity-70"
        style={{ color }}
      >
        {label}
      </div>
      <div className="text-[13px] font-mono font-semibold text-white leading-tight">
        {value}
      </div>
      {sub && (
        <div className="text-[8px] text-gray-500 font-mono leading-tight">{sub}</div>
      )}
    </div>
  );
}

// ── Corner mark / flourish ───────────────────────────────────────────────────────
function CornerMark({
  position,
  color,
}: {
  position: 'tl' | 'tr' | 'bl' | 'br';
  color: string;
}) {
  const styles: React.CSSProperties = {
    position: 'absolute',
    width: 18,
    height: 18,
    color,
    opacity: 0.5,
  };
  if (position === 'tl') Object.assign(styles, { top: 8, left: 8 });
  if (position === 'tr') Object.assign(styles, { top: 8, right: 8, transform: 'scaleX(-1)' });
  if (position === 'bl') Object.assign(styles, { bottom: 8, left: 8, transform: 'scaleY(-1)' });
  if (position === 'br') Object.assign(styles, { bottom: 8, right: 8, transform: 'scale(-1,-1)' });
  return (
    <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1" style={styles}>
      <path d="M2 8 L2 2 L8 2" />
      <circle cx="2" cy="2" r="1" fill="currentColor" />
    </svg>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────────

export function DeckCreatorDetail({
  creator,
  x,
  y,
  walletDetail,
  floorPrices,
  onClose,
}: DeckCreatorDetailProps) {
  const [flipped, setFlipped] = useState(false);
  const handle = creator.xHandle.toLowerCase();
  const tierColor = TIER_COLORS[creator.tier];

  const myHoldings = walletDetail?.direct.filter(
    (d) => d.creator.toLowerCase() === handle,
  ) ?? [];

  const prices = floorPrices?.prices[handle];

  // Portrait trading card ratio — 2.5 : 3.5
  const cardWidth = 300;
  const cardHeight = 420;
  const left = Math.max(8, Math.min(x + 14, 800 - cardWidth - 8));
  const top = Math.max(8, Math.min(y + 14, 800 - cardHeight - 8));

  // ── Back-card signal values ────────────────────────────────────────────────────
  const sig = creator.signals;
  const bestRank = typeof sig.bestRank === 'number' ? sig.bestRank : null;
  const multBreadth = typeof sig.multiplierBreadth === 'number' ? sig.multiplierBreadth : null;
  const signalRatio = typeof sig.signalRatioAvg === 'number' ? sig.signalRatioAvg : null;
  const uniqueCollectors = typeof sig.uniqueCollectors === 'number' ? sig.uniqueCollectors : null;
  const collectorDensity = typeof sig.collectorDensity === 'number' ? sig.collectorDensity : null;
  const totalXeets = typeof sig.totalXeetsExclXeetsgiving === 'number' ? sig.totalXeetsExclXeetsgiving : null;
  const ethVolume = typeof sig.ethSaleVolume === 'number' ? sig.ethSaleVolume : null;
  const deckReach = typeof sig.deckReachScore === 'number' ? sig.deckReachScore : creator.dimensions.reach;

  // ── Badges — compute which achievements fire ──────────────────────────────────
  const badges: Array<{ label: string; icon: React.ReactNode }> = [];
  if (creator.tier === 'Mythic') {
    badges.push({ label: 'Apex', icon: <ApexGlyph /> });
  }
  if (creator.dimensions.performance >= 90) {
    badges.push({ label: 'Signal', icon: <SignalGlyph /> });
  }
  if (creator.dimensions.market >= 90) {
    badges.push({ label: 'Balance', icon: <BalanceGlyph /> });
  }
  if (creator.dimensions.ecosystem >= 90) {
    badges.push({ label: 'Sol/Lun', icon: <SunMoonGlyph /> });
  }
  if (creator.dimensions.reach >= 90) {
    badges.push({ label: 'Orbital', icon: <OrbitalGlyph /> });
  }
  if (bestRank !== null && bestRank <= 3) {
    badges.push({ label: 'Crown', icon: <CrownGlyph /> });
  }
  if (multBreadth !== null && multBreadth >= 3) {
    badges.push({ label: 'Triad', icon: <TriquetraGlyph /> });
  }

  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 z-20" onClick={onClose} style={{ cursor: 'default' }} />

      {/* Flip container — 3D perspective */}
      <div
        className="absolute z-30"
        style={{
          left,
          top,
          width: cardWidth,
          height: cardHeight,
          perspective: 1400,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative w-full h-full transition-transform duration-700 ease-out"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* ── FRONT ─────────────────────────────────────────────────────────── */}
          <div
            className="absolute inset-0 rounded-xl border bg-[rgba(15,15,15,0.98)] p-3 shadow-2xl backdrop-blur flex flex-col"
            style={{
              borderColor: `${tierColor}55`,
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              boxShadow: `0 10px 40px ${tierColor}22, 0 0 0 1px ${tierColor}30 inset`,
            }}
          >
            {/* Corner marks */}
            <CornerMark position="tl" color={tierColor} />
            <CornerMark position="tr" color={tierColor} />
            <CornerMark position="bl" color={tierColor} />
            <CornerMark position="br" color={tierColor} />

            {/* Header: PFP + close */}
            <div className="flex items-start gap-3 mb-2">
              <div
                className="rounded-full p-0.5"
                style={{ background: tierColor, boxShadow: `0 0 14px ${tierColor}99` }}
              >
                <CardAvatar handle={handle} size={56} />
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <div className="text-[14px] font-semibold text-white truncate">
                  {creator.displayName}
                </div>
                <div className="text-[10px] text-gray-500 truncate">@{creator.xHandle}</div>
              </div>
              <button
                onClick={onClose}
                className="text-gray-500 hover:text-white text-base leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Tier + rank + score strip */}
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ background: `${tierColor}25`, color: tierColor }}
              >
                {creator.tier}
              </span>
              <span className="text-[10px] text-gray-500 font-mono">#{creator.rank}</span>
              <span className="ml-auto text-[12px] font-mono text-gray-200">
                {creator.compositeScore.toFixed(1)}
              </span>
            </div>

            {/* Dimension bars */}
            <div className="space-y-1.5 mb-3">
              <DimensionBar label="Performance" value={creator.dimensions.performance} color={tierColor} />
              <DimensionBar label="Ecosystem" value={creator.dimensions.ecosystem} color={tierColor} />
              <DimensionBar label="Reach" value={creator.dimensions.reach} color={tierColor} />
              <DimensionBar label="Market" value={creator.dimensions.market} color={tierColor} />
            </div>

            {/* Holdings */}
            {myHoldings.length > 0 && (
              <div className="mb-3 px-2 py-1.5 rounded bg-[#378ADD]/10 border border-[#378ADD]/20">
                <div className="text-[9px] uppercase tracking-wider text-[#378ADD]/80 mb-0.5">
                  You hold
                </div>
                <div className="text-[11px] text-gray-200">
                  {myHoldings
                    .map((h) => `${h.quantity} ${h.rarity}${h.quantity > 1 ? 's' : ''}`)
                    .join(' · ')}
                </div>
              </div>
            )}

            {/* Floor prices — clickable links, blue text */}
            <div className="space-y-1 mt-auto">
              <div className="text-[9px] uppercase tracking-wider text-gray-600">Floor prices</div>
              {prices ? (
                <div className="grid grid-cols-3 gap-1 text-[10px]">
                  {(['common', 'rare', 'legendary'] as const).map((r) => {
                    const p = prices[r];
                    const os = p?.osFloor;
                    const xeet = p?.xeetFloor;
                    const rarityCap = (r[0].toUpperCase() + r.slice(1)) as
                      | 'Common'
                      | 'Rare'
                      | 'Legendary';
                    const href = osListingUrl(creator.displayName, rarityCap);
                    const hasPrice = os !== null && os !== undefined || xeet !== null && xeet !== undefined;
                    const content = os ? (
                      <span className="font-mono">{os.toFixed(os < 0.01 ? 4 : 3)} ETH</span>
                    ) : xeet ? (
                      <span className="font-mono">{xeet.toLocaleString()} XEETS</span>
                    ) : (
                      <span className="text-gray-700">—</span>
                    );
                    return (
                      <a
                        key={r}
                        href={hasPrice ? href : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`rounded bg-white/[0.03] px-1.5 py-1 text-center block transition-colors ${
                          hasPrice ? 'hover:bg-[#2081E2]/15 cursor-pointer' : 'cursor-default'
                        }`}
                        style={{ color: hasPrice ? '#2081E2' : undefined }}
                      >
                        <div className="text-[9px] text-gray-500 capitalize">{r}</div>
                        {content}
                      </a>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[10px] text-gray-600">No floor data</div>
              )}
            </div>

            {/* Flip button */}
            <button
              onClick={() => setFlipped(true)}
              className="mt-2 text-center text-[10px] uppercase tracking-widest py-1 rounded border transition-colors"
              style={{
                borderColor: `${tierColor}40`,
                color: tierColor,
                background: `${tierColor}0a`,
              }}
            >
              ⟲ Reveal
            </button>
          </div>

          {/* ── BACK ──────────────────────────────────────────────────────────── */}
          <div
            className="absolute inset-0 rounded-xl border bg-[rgba(10,10,12,0.98)] p-3 shadow-2xl flex flex-col"
            style={{
              borderColor: `${tierColor}55`,
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              boxShadow: `0 10px 40px ${tierColor}22, 0 0 0 1px ${tierColor}30 inset`,
              backgroundImage: `radial-gradient(circle at 50% 30%, ${tierColor}18 0%, transparent 60%)`,
            }}
          >
            {/* Sacred-geometry grid overlay (faint) */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 300 420"
              fill="none"
              stroke={tierColor}
              strokeWidth="0.5"
              opacity="0.07"
            >
              <circle cx="150" cy="120" r="90" />
              <circle cx="150" cy="120" r="60" />
              <circle cx="150" cy="120" r="30" />
              <path d="M150 30 L240 150 L150 210 L60 150 Z" />
              <path d="M60 50 L240 50 M60 370 L240 370" />
            </svg>

            <CornerMark position="tl" color={tierColor} />
            <CornerMark position="tr" color={tierColor} />
            <CornerMark position="bl" color={tierColor} />
            <CornerMark position="br" color={tierColor} />

            {/* Header */}
            <div className="relative flex items-center justify-between mb-2">
              <div
                className="text-[9px] uppercase tracking-[0.25em] font-mono"
                style={{ color: tierColor }}
              >
                {creator.tier} · #{creator.rank}
              </div>
              <button
                onClick={() => setFlipped(false)}
                className="text-gray-500 hover:text-white text-[10px] uppercase tracking-widest"
              >
                ↶ Face
              </button>
            </div>

            {/* Reach score — HERO */}
            <div className="relative flex flex-col items-center justify-center py-2 mb-2">
              <div
                className="text-[8px] uppercase tracking-[0.3em] font-mono opacity-70"
                style={{ color: tierColor }}
              >
                Reach
              </div>
              <div
                className="text-[48px] leading-none font-mono font-bold"
                style={{
                  color: tierColor,
                  textShadow: `0 0 20px ${tierColor}88, 0 0 40px ${tierColor}44`,
                }}
              >
                {deckReach.toFixed(0)}
              </div>
              <div className="text-[9px] text-gray-500 font-mono mt-0.5">
                composite {creator.compositeScore.toFixed(1)}
              </div>
            </div>

            {/* Badges row */}
            {badges.length > 0 && (
              <div className="relative flex flex-wrap items-start justify-center gap-2 mb-3 px-1">
                {badges.map((b, i) => (
                  <Badge key={i} label={b.label} icon={b.icon} color={tierColor} />
                ))}
              </div>
            )}

            {/* Stats grid */}
            <div className="relative grid grid-cols-2 gap-1.5 mt-auto">
              <GridCell
                label="Best rank"
                value={bestRank !== null ? `#${bestRank}` : '—'}
                color={tierColor}
              />
              <GridCell
                label="Mult breadth"
                value={multBreadth !== null ? String(multBreadth) : '—'}
                color={tierColor}
              />
              <GridCell
                label="Signal ratio"
                value={signalRatio !== null ? signalRatio.toFixed(2) : '—'}
                color={tierColor}
              />
              <GridCell
                label="Collectors"
                value={uniqueCollectors !== null ? String(uniqueCollectors) : '—'}
                sub={collectorDensity !== null ? `density ${collectorDensity.toFixed(2)}` : undefined}
                color={tierColor}
              />
              <GridCell
                label="Xeets"
                value={totalXeets !== null ? totalXeets.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
                color={tierColor}
              />
              <GridCell
                label="ETH volume"
                value={ethVolume !== null ? ethVolume.toFixed(2) : '—'}
                color={tierColor}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
