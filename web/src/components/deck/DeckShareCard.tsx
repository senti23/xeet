'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WalletScoreSummary, WalletScoreDetail } from '@/types/deck';
import {
  type CreatorScore,
  type Tier,
  type CardRarity,
  TIER_COLORS,
  TIER_BORDER_WIDTH,
  TIER_ORDER,
  TIER_WEIGHT,
  RARITY_WEIGHT,
} from '@/types/xccScores';

// Card-rarity colors (distinct from creator-tier colors).
const RARITY_COLORS: Record<'legendary' | 'rare' | 'common', string> = {
  legendary: '#D85A30',
  rare: '#378ADD',
  common: '#888780',
};

// Ring config — 1200x1200 canvas
// Rings enlarged (scale 1.15x vs DeckRings) for maximum screenshot impact.
// Stats pushed down to y=1020+.
const SHARE_CANVAS = 1200;
const RING_CENTER_Y = 560;   // rings vertical center
const RING_RADIUS_SCALE = 1.15; // base radii from DeckRings × 1.15

const RING_CONFIG: Record<Tier, { radius: number; pfp: number }> = {
  Mythic:    { radius: 95  * RING_RADIUS_SCALE, pfp: 30 * RING_RADIUS_SCALE },
  Legendary: { radius: 160 * RING_RADIUS_SCALE, pfp: 26 * RING_RADIUS_SCALE },
  Epic:      { radius: 220 * RING_RADIUS_SCALE, pfp: 22 * RING_RADIUS_SCALE },
  Rare:      { radius: 278 * RING_RADIUS_SCALE, pfp: 19 * RING_RADIUS_SCALE },
  Common:    { radius: 332 * RING_RADIUS_SCALE, pfp: 16 * RING_RADIUS_SCALE },
};
const CENTER_R = 36 * RING_RADIUS_SCALE;

interface DeckShareCardProps {
  wallet: WalletScoreSummary;
  walletDetail: WalletScoreDetail;
  xccScores: CreatorScore[];
  bucketRank?: { rank: number; bucketSize: number; bucketLabel: string } | null;
  onClose: () => void;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360}, 35%, 25%)`;
}

export function DeckShareCard({
  wallet,
  walletDetail,
  xccScores,
  bucketRank,
  onClose,
}: DeckShareCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'copied' | 'error'>('loading');

  const render = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !xccScores.length) return;

    canvas.width = SHARE_CANVAS;
    canvas.height = SHARE_CANVAS;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;

    // 1. Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, SHARE_CANVAS, SHARE_CANVAS);

    // Subtle radial glow in center
    const gradient = ctx.createRadialGradient(
      SHARE_CANVAS / 2, RING_CENTER_Y,
      0,
      SHARE_CANVAS / 2, RING_CENTER_Y,
      RING_CONFIG.Common.radius + 20,
    );
    gradient.addColorStop(0, 'rgba(229, 57, 53, 0.08)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SHARE_CANVAS, SHARE_CANVAS);

    // Pre-compute deck strength + totals + rarity counts from the current
    // (per-rarity) detail data. This is the same formula as
    // DeckStrengthLeaderboard / DeckDetailsCard so all three stay in sync.
    const tierByHandle = new Map<string, Tier>();
    for (const c of xccScores) tierByHandle.set(c.xHandle.toLowerCase(), c.tier);

    let deckStrength = 0;
    let totalCardsHeld = 0;
    const rarityCountsCard: Record<'legendary' | 'rare' | 'common', number> = {
      legendary: 0, rare: 0, common: 0,
    };
    for (const h of walletDetail.direct) {
      const r = (h.rarity || '').toLowerCase() as CardRarity;
      if (r in rarityCountsCard) rarityCountsCard[r] += h.quantity;
      const tier = tierByHandle.get(h.creator.toLowerCase());
      if (!tier) continue;
      const rarityMult = RARITY_WEIGHT[r] ?? 1;
      deckStrength += TIER_WEIGHT[tier] * rarityMult * h.quantity;
      totalCardsHeld += h.quantity;
    }
    const uniqueCreators = new Set(
      walletDetail.direct.map((d) => d.creator.toLowerCase()),
    ).size;

    // 2. Header strip (y=0-120)
    const displayName = wallet.displayName || wallet.xHandle || 'Wallet';
    ctx.font = 'bold 42px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${displayName}'s Deck`, 60, 60);

    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#888780';
    ctx.fillText('Xeet Creator Cards · Deck Strength', 60, 100);

    // Top right: DECK STRENGTH (hero number) + optional bucket rank.
    ctx.textAlign = 'right';
    ctx.font = 'bold 72px "Courier New", monospace';
    ctx.fillStyle = '#E53935';
    ctx.fillText(deckStrength.toFixed(1), SHARE_CANVAS - 60, 60);

    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#ccc';
    ctx.fillText('Deck Strength', SHARE_CANVAS - 60, 95);

    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#666';
    if (bucketRank) {
      ctx.fillText(
        `#${bucketRank.rank} of ${bucketRank.bucketSize} ${bucketRank.bucketLabel} decks · ${totalCardsHeld} cards`,
        SHARE_CANVAS - 60,
        115,
      );
    } else {
      ctx.fillText(
        `${totalCardsHeld} cards · ${uniqueCreators} creators`,
        SHARE_CANVAS - 60,
        115,
      );
    }

    // 3. Rings (y=120-900), center (600, 510)
    const cx = SHARE_CANVAS / 2;
    const cy = RING_CENTER_Y;

    // Faint guide circles
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (const tier of TIER_ORDER) {
      ctx.beginPath();
      ctx.arc(cx, cy, RING_CONFIG[tier].radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Compute node positions
    const byTier: Record<Tier, CreatorScore[]> = {
      Mythic: [], Legendary: [], Epic: [], Rare: [], Common: [],
    };
    for (const s of xccScores) if (byTier[s.tier]) byTier[s.tier].push(s);
    for (const t of TIER_ORDER) byTier[t].sort((a, b) => b.compositeScore - a.compositeScore);

    interface NodePos {
      handle: string;
      displayName: string;
      tier: Tier;
      x: number;
      y: number;
      r: number;
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
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          r: pfp / 2,
        });
      }
    }
    const nodeByHandle = new Map<string, NodePos>();
    for (const n of nodes) nodeByHandle.set(n.handle, n);

    const held = new Set(walletDetail.direct.map(d => d.creator.toLowerCase()));
    const reached = new Set(
      Object.keys(walletDetail.secondary).map(k => k.toLowerCase()),
    );

    // Reach lines disabled — too noisy

    // Load all required avatars in parallel
    const handlesToLoad = Array.from(new Set(nodes.map(n => n.handle)));
    if (wallet.xHandle) handlesToLoad.push(wallet.xHandle.toLowerCase());
    const imageMap = new Map<string, HTMLImageElement>();
    await Promise.all(
      handlesToLoad.map(async (h) => {
        const img = await loadImage(`/avatars/${h}.jpg`);
        if (img) imageMap.set(h, img);
      }),
    );

    // Draw nodes
    for (const node of nodes) {
      let opacity = 1;
      let glow = false;
      let isUnreachable = false;
      if (held.has(node.handle)) {
        opacity = 1;
        glow = true;
      } else if (reached.has(node.handle)) {
        opacity = 0.55;
      } else {
        isUnreachable = true;
      }

      if (isUnreachable) {
        ctx.fillStyle = '#0a0a0a';
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(80,80,80,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }

      ctx.globalAlpha = opacity;

      if (glow) {
        ctx.save();
        ctx.shadowColor = TIER_COLORS[node.tier];
        ctx.shadowBlur = 8;
        ctx.fillStyle = TIER_COLORS[node.tier];
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const img = imageMap.get(node.handle);
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, node.x - node.r, node.y - node.r, node.r * 2, node.r * 2);
        ctx.restore();
      } else {
        ctx.fillStyle = hashColor(node.handle);
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `${Math.max(8, node.r * 0.8)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(node.displayName[0]?.toUpperCase() || '?', node.x, node.y);
      }

      const borderW = TIER_BORDER_WIDTH[node.tier];
      ctx.strokeStyle = TIER_COLORS[node.tier];
      ctx.lineWidth = borderW;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r + borderW / 2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 1;
    }

    // Center node — wallet pfp
    const walletImg = wallet.xHandle
      ? imageMap.get(wallet.xHandle.toLowerCase())
      : null;
    if (walletImg) {
      ctx.save();
      ctx.shadowColor = '#E53935';
      ctx.shadowBlur = 25;
      ctx.fillStyle = '#E53935';
      ctx.beginPath();
      ctx.arc(cx, cy, CENTER_R + 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, CENTER_R, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(walletImg, cx - CENTER_R, cy - CENTER_R, CENTER_R * 2, CENTER_R * 2);
      ctx.restore();

      ctx.strokeStyle = '#E53935';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, CENTER_R, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(cx, cy, CENTER_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#E53935';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#E53935';
      ctx.font = `bold ${CENTER_R * 0.7}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('XEET', cx, cy);
    }

    // 4. Stats chrome (y=970-1170) — pushed lower so rings dominate.
    // Two sections: Card Rarity (top) + Creator Tier Coverage (below).
    const RARITY_Y = 940;

    // Card Rarity row — by CARD, summed by quantity.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#888780';
    ctx.fillText('CARD RARITY', SHARE_CANVAS / 2, RARITY_Y);

    // 3 pills side-by-side, centered.
    const rarityOrder: Array<'legendary' | 'rare' | 'common'> = [
      'legendary', 'rare', 'common',
    ];
    const pillW = 180;
    const pillGap = 12;
    const pillTotalW = pillW * rarityOrder.length + pillGap * (rarityOrder.length - 1);
    const pillStartX = (SHARE_CANVAS - pillTotalW) / 2;
    const pillY = RARITY_Y + 24;
    const pillH = 36;

    rarityOrder.forEach((r, i) => {
      const x = pillStartX + i * (pillW + pillGap);
      // Background (rounded — fall back to plain rect if roundRect missing)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      const rrCtx = ctx as CanvasRenderingContext2D & {
        roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
      };
      if (typeof rrCtx.roundRect === 'function') {
        ctx.beginPath();
        rrCtx.roundRect(x, pillY, pillW, pillH, 18);
        ctx.fill();
      } else {
        ctx.fillRect(x, pillY, pillW, pillH);
      }
      // Color dot
      ctx.fillStyle = RARITY_COLORS[r];
      ctx.beginPath();
      ctx.arc(x + 18, pillY + pillH / 2, 5, 0, Math.PI * 2);
      ctx.fill();
      // Label
      ctx.textAlign = 'left';
      ctx.font = '13px sans-serif';
      ctx.fillStyle = '#ddd';
      const label = r.charAt(0).toUpperCase() + r.slice(1);
      ctx.fillText(label, x + 32, pillY + pillH / 2);
      // Count
      ctx.textAlign = 'right';
      ctx.font = 'bold 15px "Courier New", monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText(String(rarityCountsCard[r]), x + pillW - 16, pillY + pillH / 2);
    });

    // Creator Tier Coverage — bar rows (moved down to make room for rarity).
    const STATS_Y = pillY + pillH + 28;

    // Compute tier held counts
    const tierCounts: Record<Tier, { held: number; total: number }> = {
      Mythic: { held: 0, total: 0 },
      Legendary: { held: 0, total: 0 },
      Epic: { held: 0, total: 0 },
      Rare: { held: 0, total: 0 },
      Common: { held: 0, total: 0 },
    };
    for (const c of xccScores) {
      tierCounts[c.tier].total++;
      if (held.has(c.xHandle.toLowerCase())) tierCounts[c.tier].held++;
    }

    // Header (centered)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#888780';
    ctx.fillText('CREATOR TIER COVERAGE', SHARE_CANVAS / 2, STATS_Y);

    // Bar rows (same layout as before, just moved lower + centered horizontally)
    const tierLabelW = 100;
    const tierBarW = 240;
    const countColW = 60;
    const blockW = tierLabelW + tierBarW + countColW;
    const tierBlockX = (SHARE_CANVAS - blockW) / 2;
    let rowY = STATS_Y + 22;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (const tier of TIER_ORDER) {
      const { held, total } = tierCounts[tier];
      const pct = total > 0 ? held / total : 0;

      ctx.fillStyle = TIER_COLORS[tier];
      ctx.beginPath();
      ctx.arc(tierBlockX + 6, rowY, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#ddd';
      ctx.fillText(tier, tierBlockX + 20, rowY);

      // Bar background
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.fillRect(tierBlockX + tierLabelW, rowY - 4, tierBarW, 8);

      // Bar fill
      ctx.fillStyle = TIER_COLORS[tier];
      ctx.fillRect(tierBlockX + tierLabelW, rowY - 4, tierBarW * pct, 8);

      // Count
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillStyle = '#ddd';
      ctx.textAlign = 'right';
      ctx.fillText(
        `${held}/${total}`,
        tierBlockX + tierLabelW + tierBarW + countColW - 4,
        rowY,
      );
      ctx.textAlign = 'left';
      rowY += 18;
    }

    // 5. Footer (y=1140-1200)
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#555';
    ctx.textAlign = 'center';
    ctx.fillText(
      'xeet-deck-reach-score.vercel.app',
      SHARE_CANVAS / 2,
      SHARE_CANVAS - 30,
    );

    // Convert to blob
    canvas.toBlob(
      (blob) => {
        if (blob) {
          setImageBlob(blob);
          setImageUrl(URL.createObjectURL(blob));
          setStatus('ready');
        } else {
          setStatus('error');
        }
      },
      'image/png',
      0.95,
    );
  }, [wallet, walletDetail, xccScores, bucketRank]);

  useEffect(() => {
    render();
  }, [render]);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const copyToClipboard = async () => {
    if (!imageBlob) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': imageBlob }),
      ]);
      setStatus('copied');
      setTimeout(() => setStatus('ready'), 2000);
    } catch {
      downloadImage();
    }
  };

  const downloadImage = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    const name = wallet.xHandle || 'deck';
    a.download = `${name}-deck-rings.png`;
    a.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm overflow-y-auto py-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative mx-4 max-w-2xl w-full rounded-2xl p-6"
        style={{
          background: 'rgba(15, 15, 15, 0.98)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-white transition-colors text-xl leading-none"
        >
          ×
        </button>

        <h3 className="text-lg font-bold mb-4">Share Your Deck</h3>

        <canvas ref={canvasRef} className="hidden" />

        <div
          className="rounded-xl overflow-hidden mb-4 bg-black flex items-center justify-center"
          style={{ aspectRatio: '1 / 1' }}
        >
          {status === 'loading' && (
            <p className="text-gray-500 text-sm">Generating card...</p>
          )}
          {status === 'error' && (
            <p className="text-red-400 text-sm">Failed to generate. Try again.</p>
          )}
          {imageUrl && (
            <img
              src={imageUrl}
              alt="Deck card"
              className="max-w-full max-h-[600px] object-contain"
            />
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={copyToClipboard}
            disabled={!imageBlob || status === 'loading'}
            className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            style={{ background: status === 'copied' ? '#1D9E75' : '#E53935' }}
          >
            {status === 'copied' ? '✓ Copied!' : '📋 Copy for Twitter'}
          </button>
          <button
            onClick={downloadImage}
            disabled={!imageUrl || status === 'loading'}
            className="flex-1 rounded-lg border border-white/15 py-2.5 text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50"
          >
            ↓ Download PNG
          </button>
        </div>
      </div>
    </div>
  );
}
