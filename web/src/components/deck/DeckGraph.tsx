'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import {
  forceSimulation,
  forceCenter,
  forceManyBody,
  forceCollide,
  forceRadial,
  type Simulation,
  type SimulationNodeDatum,
} from 'd3-force';
import type { WalletScoreSummary, WalletScoreDetail, CreatorProfiles } from '@/types/deck';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface DeckGraphProps {
  walletData: WalletScoreSummary | null;
  detail: WalletScoreDetail | null;
  profiles: CreatorProfiles | null;
}

// ─── Internal types ──────────────────────────────────────────────────────────

interface GraphNode extends SimulationNodeDatum {
  id: string;
  type: 'center' | 'direct' | 'secondary';
  radius: number;
  rarity?: string;
  bridgeCount: number;
  displayName: string;
  birthTime: number;
  parentId?: string;
  // For entrance animation
  startX?: number;
  startY?: number;
  // For secondary burst animation
  targetX?: number;
  targetY?: number;
  lineProgress?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const COLORS = {
  bg: '#0a0a0a',
  grid: 'rgba(255, 255, 255, 0.03)',
  centerGlow: '#E53935',
  selectedRing: '#ffffff',
  dimText: '#666',
};

const RARITY: Record<string, {
  color: string; borderW: number; lineW: number; lineAlpha: number; order: number;
}> = {
  legendary: { color: '#D85A30', borderW: 4, lineW: 1.5, lineAlpha: 0.8, order: 0 },
  rare:      { color: '#378ADD', borderW: 3, lineW: 1.0, lineAlpha: 0.5, order: 1 },
  common:    { color: '#888780', borderW: 2, lineW: 0.5, lineAlpha: 0.25, order: 2 },
};

const CENTER_R = 35;
const MIN_R = 12;
const MAX_R = 28;
const SEC_R = 8;
const ENTRANCE_MS = 5000;
const MAX_SEC = 80;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360}, 35%, 25%)`;
}

function clamp(lo: number, v: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutCubic(t: number): number { return 1 - Math.pow(1 - t, 3); }

function getRarity(r?: string) { return RARITY[r || 'common'] || RARITY.common; }

// ─── Component ───────────────────────────────────────────────────────────────

export function DeckGraph({ walletData, detail, profiles }: DeckGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<GraphNode, never> | null>(null);
  const rafRef = useRef<number>(0);
  const nodesRef = useRef<GraphNode[]>([]);
  const secNodesRef = useRef<GraphNode[]>([]);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const startRef = useRef(0);
  const selectedRef = useRef<string | null>(null);
  const hoveredRef = useRef<GraphNode | null>(null);
  const sizeRef = useRef({ w: 800, h: 600 });
  const bridgeIndexRef = useRef<Map<string, string[]>>(new Map());
  const namesRef = useRef<Map<string, string>>(new Map());
  const secAnimRef = useRef(0);
  const ringRadiusRef = useRef(200);

  const [tooltip, setTooltip] = useState<{
    x: number; y: number; name: string;
    rarity?: string; bridges?: number; via?: string;
  } | null>(null);

  // ─── Display name lookup ──────────────────────────────────────────────────

  const getName = useCallback((handle: string): string => {
    return namesRef.current.get(handle) || handle;
  }, []);

  // ─── Load avatar ──────────────────────────────────────────────────────────

  const loadAvatar = useCallback((handle: string) => {
    if (imagesRef.current.has(handle) || loadingRef.current.has(handle)) return;
    loadingRef.current.add(handle);
    const img = new Image();
    img.onload = () => { imagesRef.current.set(handle, img); loadingRef.current.delete(handle); };
    img.onerror = () => { loadingRef.current.delete(handle); };
    img.src = `/avatars/${handle}.jpg`;
  }, []);

  // ─── Draw helpers ─────────────────────────────────────────────────────────

  const drawCircleImg = useCallback((
    ctx: CanvasRenderingContext2D, img: HTMLImageElement,
    x: number, y: number, r: number,
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }, []);

  const drawInitials = useCallback((
    ctx: CanvasRenderingContext2D, x: number, y: number, r: number, handle: string,
  ) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = hashColor(handle);
    ctx.fill();
    const initials = getName(handle).slice(0, 2).toUpperCase();
    ctx.fillStyle = '#aaa';
    ctx.font = `bold ${Math.max(r * 0.7, 7)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, x, y + 1);
  }, [getName]);

  const drawNode = useCallback((
    ctx: CanvasRenderingContext2D, x: number, y: number, r: number,
    handle: string, rConf: typeof RARITY.common, alpha: number,
    isHovered: boolean, isSelected: boolean,
  ) => {
    ctx.globalAlpha = alpha;

    // Hover glow
    if (isHovered) {
      ctx.save();
      ctx.shadowColor = rConf.color;
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.strokeStyle = rConf.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // Image or initials
    const img = imagesRef.current.get(handle);
    if (img) {
      drawCircleImg(ctx, img, x, y, r);
    } else {
      drawInitials(ctx, x, y, r, handle);
    }

    // Rarity border
    ctx.beginPath();
    ctx.arc(x, y, r + rConf.borderW / 2, 0, Math.PI * 2);
    ctx.strokeStyle = rConf.color;
    ctx.lineWidth = rConf.borderW;
    ctx.stroke();

    // Selection ring
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(x, y, r + rConf.borderW + 3, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.selectedRing;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }, [drawCircleImg, drawInitials]);

  // ─── Main setup effect ────────────────────────────────────────────────────

  useEffect(() => {
    if (!walletData || !detail || !profiles || !canvasRef.current || !containerRef.current) return;

    // Build name map
    const nameMap = new Map<string, string>();
    for (const [handle, p] of Object.entries(profiles)) {
      nameMap.set(handle.toLowerCase(), handle);
      if (p && typeof p === 'object') nameMap.set(handle.toLowerCase(), handle);
    }
    for (const h of detail.direct) {
      const lc = h.creator.toLowerCase();
      if (!nameMap.has(lc)) nameMap.set(lc, h.creator);
    }
    namesRef.current = nameMap;

    // Build bridge index: directHandle -> [secondaryCreators]
    const bridgeCounts = new Map<string, number>();
    const bridgeIndex = new Map<string, string[]>();
    for (const [secCreator, bridges] of Object.entries(detail.secondary)) {
      for (const bh of bridges) {
        const lc = bh.toLowerCase();
        bridgeCounts.set(lc, (bridgeCounts.get(lc) || 0) + 1);
        if (!bridgeIndex.has(lc)) bridgeIndex.set(lc, []);
        bridgeIndex.get(lc)!.push(secCreator);
      }
    }
    bridgeIndexRef.current = bridgeIndex;

    // Sort direct nodes: legendaries first
    const sorted = [...detail.direct].sort((a, b) =>
      (getRarity(a.rarity).order) - (getRarity(b.rarity).order)
    );

    const maxBridge = Math.max(1, ...Array.from(bridgeCounts.values()));

    // Canvas auto-sizing
    const directCount = sorted.length;
    const canvasH = Math.max(600, 400 + directCount * 4 + maxBridge * 2 + 100);

    // Set container height
    containerRef.current.style.height = canvasH + 'px';

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;

    function resize() {
      if (!containerRef.current || !canvas) return;
      const rect = containerRef.current.getBoundingClientRect();
      const nw = Math.floor(rect.width);
      const nh = canvasH;
      sizeRef.current = { w: nw, h: nh };
      canvas.width = nw * dpr;
      canvas.height = nh * dpr;
      canvas.style.width = nw + 'px';
      canvas.style.height = nh + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(containerRef.current);

    const { w, h } = sizeRef.current;
    const cx = w / 2;
    const cy = canvasH / 2;

    // Ring radius — leaves outer space for secondary burst
    const ringR = Math.max(150, Math.min(w, canvasH) * 0.25 + Math.min(directCount, 200) * 0.6);
    ringRadiusRef.current = ringR;

    // Build nodes
    const centerNode: GraphNode = {
      id: '__center__', type: 'center', radius: CENTER_R,
      bridgeCount: 0, displayName: walletData.displayName || 'You',
      birthTime: 0, x: cx, y: cy, fx: cx, fy: cy,
    };

    const directNodes: GraphNode[] = sorted.map((holding, i) => {
      const lc = holding.creator.toLowerCase();
      const bc = bridgeCounts.get(lc) || 0;
      const frac = bc / maxBridge;
      const radius = MIN_R + frac * (MAX_R - MIN_R);

      // Stagger: legendaries 0.1-0.24, rares 0.24-0.5, commons 0.5-0.7
      const rConf = getRarity(holding.rarity);
      let bt: number;
      if (rConf.order === 0) bt = 0.1 + (i / Math.max(1, directCount - 1)) * 0.14; // legendary
      else if (rConf.order === 1) bt = 0.24 + (i / Math.max(1, directCount - 1)) * 0.26; // rare
      else bt = 0.5 + (i / Math.max(1, directCount - 1)) * 0.2; // common

      // Pre-compute angle for entrance start position
      const angle = (i / directCount) * Math.PI * 2 - Math.PI / 2;
      const startDist = Math.max(w, canvasH) * 1.5;

      return {
        id: lc, type: 'direct' as const, radius, rarity: holding.rarity,
        bridgeCount: bc, displayName: getName(lc), birthTime: bt,
        startX: cx + Math.cos(angle) * startDist,
        startY: cy + Math.sin(angle) * startDist,
        x: cx + Math.cos(angle) * ringR,
        y: cy + Math.sin(angle) * ringR,
      };
    });

    const allNodes = [centerNode, ...directNodes];
    nodesRef.current = allNodes;
    secNodesRef.current = [];
    selectedRef.current = null;

    // Preload images
    if (walletData.xHandle) loadAvatar(walletData.xHandle.toLowerCase());
    for (const n of directNodes) loadAvatar(n.id);

    // Force simulation
    const sim = forceSimulation<GraphNode>(allNodes)
      .force('center', forceCenter(cx, cy).strength(0.01))
      .force('charge', forceManyBody<GraphNode>().strength(d => d.type === 'center' ? 0 : -60))
      .force('collide', forceCollide<GraphNode>().radius(d => d.radius + 4).strength(0.9))
      .force('radial', forceRadial<GraphNode>(
        d => d.type === 'center' ? 0 : ringR,
        cx, cy,
      ).strength(0.6))
      .alphaDecay(0.012)
      .velocityDecay(0.3)
      .alpha(1);

    // Pre-warm
    for (let i = 0; i < 120; i++) sim.tick();

    // Store final sim positions into startX/startY doesn't change — keep startX as entrance origin
    // The sim has settled nodes into ring positions. Store those as the "target" for entrance lerp.
    // startX/startY = far away (already set). sim x/y = ring positions (already set by pre-warm).

    simRef.current = sim;
    startRef.current = performance.now();

    // ─── Render loop ────────────────────────────────────────────────────────

    function draw() {
      const { w } = sizeRef.current;
      const h = canvasH;
      const now = performance.now();
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / ENTRANCE_MS, 1);

      // Clear
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, w, h);

      // Subtle grid
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      const gs = 60;
      for (let gx = gs; gx < w; gx += gs) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
      }
      for (let gy = gs; gy < h; gy += gs) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
      }

      const selected = selectedRef.current;
      const hovered = hoveredRef.current;
      const secNodes = secNodesRef.current;

      // ─── Draw connector lines (selected → secondaries) ────────────────
      if (selected && secNodes.length > 0) {
        const parent = allNodes.find(n => n.id === selected);
        if (parent && parent.x != null && parent.y != null) {
          const rConf = getRarity(parent.rarity);
          const secElapsed = now - secAnimRef.current;

          for (const sn of secNodes) {
            if (sn.x == null || sn.y == null) continue;
            const delay = (sn.birthTime ?? 0) * 300;
            const lp = clamp(0, (secElapsed - delay) / 500, 1); // line progress
            if (lp <= 0) continue;

            const endX = lerp(parent.x, sn.x, lp);
            const endY = lerp(parent.y, sn.y, lp);

            ctx.globalAlpha = rConf.lineAlpha * lp;
            ctx.strokeStyle = rConf.color;
            ctx.lineWidth = rConf.lineW;

            // Legendary glow
            if (parent.rarity === 'legendary') {
              ctx.save();
              ctx.shadowColor = rConf.color;
              ctx.shadowBlur = 6;
              ctx.beginPath();
              ctx.moveTo(parent.x, parent.y);
              ctx.lineTo(endX, endY);
              ctx.stroke();
              ctx.restore();
            } else {
              ctx.beginPath();
              ctx.moveTo(parent.x, parent.y);
              ctx.lineTo(endX, endY);
              ctx.stroke();
            }
          }
          ctx.globalAlpha = 1;
        }
      }

      // ─── Draw direct nodes ────────────────────────────────────────────
      for (let i = allNodes.length - 1; i >= 1; i--) {
        const n = allNodes[i];
        if (n.x == null || n.y == null) continue;

        // Entrance progress for this node
        const nt = progress < n.birthTime ? 0 : clamp(0, (progress - n.birthTime) / 0.15, 1);
        if (nt <= 0) continue;

        const eased = easeOutBack(nt);
        const r = n.radius * clamp(0, nt * 1.2, 1); // scale in

        // Position: lerp from start (far) to sim position
        let nx: number, ny: number;
        if (progress < 1 && n.startX != null && n.startY != null) {
          nx = lerp(n.startX, n.x, eased);
          ny = lerp(n.startY, n.y, eased);
        } else {
          // Ambient floating
          const fx = Math.sin(now * 0.0008 + i * 0.7) * 1.5;
          const fy = Math.cos(now * 0.0006 + i * 1.1) * 1.2;
          nx = n.x + fx;
          ny = n.y + fy;
        }

        const dimmed = selected && n.id !== selected;
        const alpha = dimmed ? 0.2 : nt;
        const rConf = getRarity(n.rarity);

        drawNode(ctx, nx, ny, r, n.id, rConf, alpha,
          hovered?.id === n.id, selected === n.id);
      }

      // ─── Draw secondary nodes ─────────────────────────────────────────
      if (selected && secNodes.length > 0) {
        const secElapsed = now - secAnimRef.current;
        const parent = allNodes.find(n => n.id === selected);
        const parentRConf = parent ? getRarity(parent.rarity) : RARITY.common;

        for (const sn of secNodes) {
          if (sn.startX == null || sn.startY == null || sn.targetX == null || sn.targetY == null) continue;

          const delay = (sn.birthTime ?? 0) * 300;
          const t = clamp(0, (secElapsed - delay) / 300, 1);
          const eased = easeOutCubic(t);

          sn.x = lerp(sn.startX, sn.targetX, eased);
          sn.y = lerp(sn.startY, sn.targetY, eased);

          if (t <= 0) continue;
          const sr = SEC_R * eased;
          const alpha = t * 0.8;

          // Draw node with parent's rarity color
          drawNode(ctx, sn.x, sn.y, sr, sn.id, parentRConf, alpha,
            hovered?.id === sn.id, false);
        }
      }

      // ─── Draw center node ─────────────────────────────────────────────
      {
        const cn = allNodes[0];
        const ct = clamp(0, progress / 0.1, 1); // 0-0.5s
        const cs = easeOutBack(ct);
        const cr = CENTER_R * cs;

        if (cr > 0 && cn.x != null && cn.y != null) {
          // Red pulse glow
          const pulse = 14 + Math.sin(now * 0.003) * 6;
          ctx.save();
          ctx.shadowColor = COLORS.centerGlow;
          ctx.shadowBlur = pulse;
          ctx.beginPath();
          ctx.arc(cn.x, cn.y, cr + 4, 0, Math.PI * 2);
          ctx.strokeStyle = COLORS.centerGlow;
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();

          // Avatar
          const ch = walletData?.xHandle?.toLowerCase();
          const cImg = ch ? imagesRef.current.get(ch) : null;
          if (cImg) {
            drawCircleImg(ctx, cImg, cn.x, cn.y, cr);
          } else {
            drawInitials(ctx, cn.x, cn.y, cr, ch || 'you');
          }

          // White border
          ctx.beginPath();
          ctx.arc(cn.x, cn.y, cr + 2, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }

      // ─── Hover label (canvas-rendered for perf) ───────────────────────
      if (hovered && hovered.x != null && hovered.y != null && hovered.type !== 'center') {
        const name = getName(hovered.id);
        const label = name.length > 16 ? name.slice(0, 15) + '…' : name;
        ctx.font = 'bold 11px sans-serif';
        const tw = ctx.measureText(label).width;
        const lx = hovered.x - tw / 2 - 8;
        const ly = hovered.y + hovered.radius + 12;

        ctx.fillStyle = 'rgba(10, 10, 10, 0.92)';
        ctx.beginPath();
        ctx.roundRect(lx, ly, tw + 16, 24, 6);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#eee';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, hovered.x, ly + 12);
      }

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    // ─── Mouse interaction ──────────────────────────────────────────────

    function getPos(e: MouseEvent) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function hitTest(mx: number, my: number): GraphNode | null {
      // Check secondary first
      for (const sn of secNodesRef.current) {
        if (sn.x == null || sn.y == null) continue;
        const dx = mx - sn.x, dy = my - sn.y;
        if (dx * dx + dy * dy < (SEC_R + 5) ** 2) return sn;
      }
      // Then direct (skip center)
      for (let i = 1; i < allNodes.length; i++) {
        const n = allNodes[i];
        if (n.x == null || n.y == null) continue;
        const dx = mx - n.x, dy = my - n.y;
        if (dx * dx + dy * dy < (n.radius + 5) ** 2) return n;
      }
      return null;
    }

    function onMove(e: MouseEvent) {
      const p = getPos(e);
      const node = hitTest(p.x, p.y);
      hoveredRef.current = node;
      canvas.style.cursor = node ? 'pointer' : 'default';

      if (node && node.type !== 'center') {
        const rect = canvas.getBoundingClientRect();
        if (node.type === 'secondary') {
          setTooltip({
            x: e.clientX - rect.left, y: e.clientY - rect.top,
            name: getName(node.id), via: getName(node.parentId || ''),
          });
        } else {
          setTooltip({
            x: e.clientX - rect.left, y: e.clientY - rect.top,
            name: getName(node.id), rarity: node.rarity, bridges: node.bridgeCount,
          });
        }
      } else {
        setTooltip(null);
      }
    }

    function onClick(e: MouseEvent) {
      const p = getPos(e);
      const node = hitTest(p.x, p.y);

      if (!node || node.type !== 'direct') {
        selectedRef.current = null;
        secNodesRef.current = [];
        return;
      }

      if (selectedRef.current === node.id) {
        selectedRef.current = null;
        secNodesRef.current = [];
        return;
      }

      // Select → build secondary nodes bursting OUTWARD
      selectedRef.current = node.id;
      secAnimRef.current = performance.now();

      const secs = bridgeIndexRef.current.get(node.id) || [];
      const capped = secs.slice(0, MAX_SEC);
      const ncx = sizeRef.current.w / 2;
      const ncy = canvasH / 2;
      const parentAngle = Math.atan2((node.y ?? ncy) - ncy, (node.x ?? ncx) - ncx);

      const secNodes: GraphNode[] = capped.map((creator, i) => {
        // Fan outward ±60° from parent angle
        const spread = Math.PI * 0.7;
        const angle = parentAngle - spread / 2 + (i / Math.max(1, capped.length - 1)) * spread;
        const dist = ringRadiusRef.current + 50 + Math.random() * 90;
        const tX = ncx + Math.cos(angle) * dist;
        const tY = ncy + Math.sin(angle) * dist;

        return {
          id: creator, type: 'secondary' as const, radius: SEC_R,
          bridgeCount: 0, displayName: getName(creator),
          birthTime: i / capped.length, parentId: node.id,
          startX: node.x ?? ncx, startY: node.y ?? ncy,
          targetX: tX, targetY: tY,
          x: node.x ?? ncx, y: node.y ?? ncy,
          lineProgress: 0,
        };
      });

      // Preload secondary avatars
      for (const sn of secNodes) loadAvatar(sn.id);
      secNodesRef.current = secNodes;
    }

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('click', onClick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      sim.stop();
      simRef.current = null;
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('click', onClick);
    };
  }, [walletData, detail, profiles, loadAvatar, drawInitials, drawCircleImg, drawNode, getName]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (!walletData) {
    return (
      <div
        className="flex items-center justify-center rounded-2xl border-2 border-dashed border-gray-700"
        style={{ height: 600, background: COLORS.bg }}
      >
        <div className="text-center">
          <div className="mb-2 text-4xl opacity-20">&#x1F578;&#xFE0F;</div>
          <p className="text-sm text-gray-600">Search a wallet to see its creator network</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative rounded-2xl overflow-hidden"
      style={{ background: COLORS.bg, minHeight: 600 }}
    >
      <canvas ref={canvasRef} className="block w-full" style={{ minHeight: 600 }} />

      {/* Tooltip overlay */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg px-3 py-2 text-xs shadow-lg"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y - 8,
            background: 'rgba(10, 10, 10, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
          }}
        >
          <div className="font-semibold text-gray-100">{tooltip.name}</div>
          {tooltip.rarity && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: getRarity(tooltip.rarity).color }}
              />
              <span className="text-gray-400 capitalize">{tooltip.rarity}</span>
              {tooltip.bridges != null && tooltip.bridges > 0 && (
                <span className="text-gray-500 ml-1">· bridges to {tooltip.bridges}</span>
              )}
            </div>
          )}
          {tooltip.via && (
            <div className="text-gray-500 mt-0.5">via {tooltip.via}</div>
          )}
        </div>
      )}

      {/* Stats overlay */}
      <div className="absolute top-3 left-3 text-[10px] text-gray-600 font-mono">
        {detail?.direct.length ?? 0} direct · {Object.keys(detail?.secondary ?? {}).length} secondary
      </div>
    </div>
  );
}
