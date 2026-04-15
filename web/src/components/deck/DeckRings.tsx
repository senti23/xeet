'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WalletScoreDetail } from '@/types/deck';
import {
  type CreatorScore,
  type Tier,
  TIER_COLORS,
  TIER_BORDER_WIDTH,
  TIER_ORDER,
} from '@/types/xccScores';

// ─── Constants ───────────────────────────────────────────────────────────────

// Clean rings with per-pfp tier-colored borders — each tier is a single
// concentric circle (no staggering), matching the share-card aesthetic.
// Pfps are sized slightly larger than v2 for better presence; radii are
// spaced to give every ring breathing room at 800px reference width.
const RING_CONFIG: Record<Tier, { radius: number; pfp: number }> = {
  Mythic:    { radius: 92,  pfp: 34 }, // 25 creators
  Legendary: { radius: 160, pfp: 30 }, // 50
  Epic:      { radius: 228, pfp: 26 }, // 75
  Rare:      { radius: 298, pfp: 22 }, // 110
  Common:    { radius: 362, pfp: 18 }, // 131
};

const CENTER_R = 38;
const REF_SIZE = 800;            // radii & pfps defined at this canvas size; scale linearly
const MAX_CANVAS = 1400;
const VIEWPORT_RESERVE = 80;
const MOBILE_BREAKPOINT = 768;
const MOBILE_SCALE = 0.6;
const BG = '#0a0a0a';
const GUIDE = 'rgba(255, 255, 255, 0.04)';
const HOVER_ZOOM = 1.6;           // pfp scales to 1.6× on hover

// ─── Types ───────────────────────────────────────────────────────────────────

interface DeckRingsProps {
  xccScores: CreatorScore[];
  walletDetail: WalletScoreDetail | null;
  walletPfpHandle: string | null;
  onCreatorClick: (handle: string, x: number, y: number) => void;
}

interface NodePos {
  handle: string;
  displayName: string;
  tier: Tier;
  rank: number;
  score: CreatorScore;
  angle: number;
  baseRadius: number;
  basePfp: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function hashColor(s: string): string {
  return `hsl(${hashInt(s) % 360}, 35%, 25%)`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DeckRings({
  xccScores,
  walletDetail,
  walletPfpHandle,
  onCreatorClick,
}: DeckRingsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());

  const nodesRef = useRef<NodePos[]>([]);
  const hoveredRef = useRef<NodePos | null>(null);
  const sizeRef = useRef({ w: REF_SIZE, h: REF_SIZE, scale: 1 });

  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: NodePos;
  } | null>(null);

  // ─── Image loader ─────────────────────────────────────────────────────────

  const loadAvatar = useCallback((handle: string) => {
    const key = handle.toLowerCase();
    if (imagesRef.current.has(key) || loadingRef.current.has(key)) return;
    loadingRef.current.add(key);
    const img = new Image();
    img.onload = () => {
      imagesRef.current.set(key, img);
      loadingRef.current.delete(key);
    };
    img.onerror = () => {
      loadingRef.current.delete(key);
    };
    img.src = `/avatars/${key}.jpg`;
  }, []);

  // ─── Build node positions ────────────────────────────────────────────────

  useEffect(() => {
    if (!xccScores.length) return;

    const byTier: Record<Tier, CreatorScore[]> = {
      Mythic: [], Legendary: [], Epic: [], Rare: [], Common: [],
    };
    for (const s of xccScores) {
      if (byTier[s.tier]) byTier[s.tier].push(s);
    }
    for (const t of TIER_ORDER) {
      byTier[t].sort((a, b) => b.compositeScore - a.compositeScore);
    }

    const nodes: NodePos[] = [];
    for (const tier of TIER_ORDER) {
      const creators = byTier[tier];
      const n = creators.length;
      if (n === 0) continue;
      const { radius, pfp } = RING_CONFIG[tier];
      for (let i = 0; i < n; i++) {
        const c = creators[i];
        const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
        nodes.push({
          handle: c.xHandle.toLowerCase(),
          displayName: c.displayName,
          tier,
          rank: c.rank,
          score: c,
          angle,
          baseRadius: radius,
          basePfp: pfp,
        });
        loadAvatar(c.xHandle);
      }
    }
    nodesRef.current = nodes;

    if (walletPfpHandle) loadAvatar(walletPfpHandle);
  }, [xccScores, walletPfpHandle, loadAvatar]);

  // ─── Held / reached sets ─────────────────────────────────────────────────

  const heldSetRef = useRef<Set<string>>(new Set());
  const reachedSetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!walletDetail) {
      heldSetRef.current = new Set();
      reachedSetRef.current = new Set();
      return;
    }
    heldSetRef.current = new Set(walletDetail.direct.map(d => d.creator.toLowerCase()));
    reachedSetRef.current = new Set(Object.keys(walletDetail.secondary).map(k => k.toLowerCase()));
  }, [walletDetail]);

  // ─── Canvas resize + render loop ─────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const maxByViewport = Math.max(320, window.innerHeight - VIEWPORT_RESERVE);
      const w = Math.max(280, Math.min(rect.width, maxByViewport, MAX_CANVAS));
      const h = w;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
      const scale = (w / REF_SIZE) * (isMobile ? MOBILE_SCALE : 1);
      sizeRef.current = { w, h, scale };
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    window.addEventListener('resize', resize);

    const render = () => {
      const { w, h, scale } = sizeRef.current;
      const cx = w / 2;
      const cy = h / 2;

      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      // Faint guide circles per tier
      ctx.strokeStyle = GUIDE;
      ctx.lineWidth = 1;
      for (const tier of TIER_ORDER) {
        const cfg = RING_CONFIG[tier];
        ctx.beginPath();
        ctx.arc(cx, cy, cfg.radius * scale, 0, Math.PI * 2);
        ctx.stroke();
      }

      const hasWallet = !!walletDetail;
      const held = heldSetRef.current;
      const reached = reachedSetRef.current;
      const hovered = hoveredRef.current;

      // Draw nodes — hovered node is drawn LAST so its zoom sits above neighbors
      const drawNode = (node: NodePos, isHoverPass: boolean) => {
        const x = cx + Math.cos(node.angle) * node.baseRadius * scale;
        const y = cy + Math.sin(node.angle) * node.baseRadius * scale;
        const isHovered = hovered?.handle === node.handle;
        const zoom = isHovered ? HOVER_ZOOM : 1;
        const r = (node.basePfp / 2) * scale * zoom;

        let opacity = 1;
        let drawGlow = false;
        if (hasWallet) {
          if (held.has(node.handle)) {
            opacity = 1;
            drawGlow = true;
          } else if (reached.has(node.handle)) {
            opacity = 0.55;
          } else {
            opacity = 0.2;
          }
        }
        if (isHovered) opacity = 1;

        ctx.globalAlpha = opacity;

        const tierColor = TIER_COLORS[node.tier];
        const borderWidth = TIER_BORDER_WIDTH[node.tier] * scale * (isHovered ? 1.4 : 1);

        // Glow for held or hovered
        if (drawGlow || isHovered) {
          ctx.save();
          ctx.shadowColor = tierColor;
          ctx.shadowBlur = isHovered ? 18 : 10;
          ctx.fillStyle = tierColor;
          ctx.beginPath();
          ctx.arc(x, y, r + borderWidth / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // PFP clipped to circle, else initials fallback
        const img = imagesRef.current.get(node.handle);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
          ctx.restore();
        } else {
          ctx.fillStyle = hashColor(node.handle);
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.font = `${Math.max(8, r * 0.8)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const initial = (node.displayName || node.handle)[0]?.toUpperCase() || '?';
          ctx.fillText(initial, x, y);
        }

        // Tier-colored border
        ctx.strokeStyle = tierColor;
        ctx.lineWidth = borderWidth;
        ctx.beginPath();
        ctx.arc(x, y, r + borderWidth / 2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = 1;
        void isHoverPass;
      };

      for (const node of nodesRef.current) {
        if (hovered?.handle === node.handle) continue;
        drawNode(node, false);
      }
      if (hovered) drawNode(hovered, true);

      // Center node
      const centerR = CENTER_R * scale;
      if (walletPfpHandle) {
        const img = imagesRef.current.get(walletPfpHandle.toLowerCase());
        ctx.save();
        ctx.shadowColor = '#E53935';
        ctx.shadowBlur = 20;
        ctx.fillStyle = '#E53935';
        ctx.beginPath();
        ctx.arc(cx, cy, centerR + 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        if (img && img.complete && img.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, cx - centerR, cy - centerR, centerR * 2, centerR * 2);
          ctx.restore();
        } else {
          ctx.fillStyle = '#1a1a1a';
          ctx.beginPath();
          ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#E53935';
          ctx.font = `bold ${centerR * 0.8}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(walletPfpHandle[0]?.toUpperCase() || '?', cx, cy);
        }

        ctx.strokeStyle = '#E53935';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(229,57,53,0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = `bold ${centerR * 0.5}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('XEET', cx, cy);
      }

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [walletDetail, walletPfpHandle]);

  // ─── Mouse hit-test ──────────────────────────────────────────────────────

  const findNodeAt = useCallback((clientX: number, clientY: number): NodePos | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const { w, h, scale } = sizeRef.current;
    const cx = w / 2;
    const cy = h / 2;

    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i];
      const x = cx + Math.cos(n.angle) * n.baseRadius * scale;
      const y = cy + Math.sin(n.angle) * n.baseRadius * scale;
      const r = (n.basePfp / 2) * scale;
      const dx = mx - x;
      const dy = my - y;
      if (dx * dx + dy * dy <= (r + 2) * (r + 2)) {
        return n;
      }
    }
    return null;
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const node = findNodeAt(e.clientX, e.clientY);
      hoveredRef.current = node;
      if (node) {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        setTooltip({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          node,
        });
      } else {
        setTooltip(null);
      }
    },
    [findNodeAt],
  );

  const handleMouseLeave = useCallback(() => {
    hoveredRef.current = null;
    setTooltip(null);
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const node = findNodeAt(e.clientX, e.clientY);
      if (node) {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        onCreatorClick(
          node.handle,
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
      }
    },
    [findNodeAt, onCreatorClick],
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full mx-auto flex items-center justify-center"
      style={{ maxWidth: MAX_CANVAS }}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        className="block w-full h-full cursor-pointer"
      />

      {tooltip && (
        <div
          className="pointer-events-none absolute z-20 rounded-lg border border-white/10 bg-[rgba(10,10,10,0.95)] px-3 py-2 text-xs shadow-lg"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            transform:
              tooltip.x > sizeRef.current.w - 200 ? 'translateX(-100%) translateX(-24px)' : undefined,
          }}
        >
          <div className="font-semibold text-white">{tooltip.node.displayName}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: TIER_COLORS[tooltip.node.tier] }}
            />
            <span className="text-gray-300">{tooltip.node.tier}</span>
            <span className="text-gray-500">#{tooltip.node.rank}</span>
          </div>
          <div className="text-gray-400 mt-1 font-mono">
            Score: {tooltip.node.score.compositeScore.toFixed(1)}
          </div>
          <div className="text-[10px] text-gray-500 font-mono mt-0.5">
            P:{tooltip.node.score.dimensions.performance.toFixed(0)} ·
            E:{tooltip.node.score.dimensions.ecosystem.toFixed(0)} ·
            R:{tooltip.node.score.dimensions.reach.toFixed(0)} ·
            M:{tooltip.node.score.dimensions.market.toFixed(0)}
          </div>
        </div>
      )}
    </div>
  );
}
