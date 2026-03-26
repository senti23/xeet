'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { WalletScoreSummary } from '@/types/deck';

// Xeet rare card (token #27) for non-XCC holders
const XEET_RARE_URL =
  'https://i2c.seadn.io/abstract/0xec27d2237432d06981e1f18581494661517e1bd3/cb868470bc6eb2120e284c7ef6f40b/13cb868470bc6eb2120e284c7ef6f40b.png';

// Card dimensions: 400x500 native, render at 2x for sharpness
const CARD_W = 800;
const CARD_H = 1000;

interface FlexDeckModalProps {
  wallet: WalletScoreSummary;
  onClose: () => void;
}

type RareCards = Record<string, string>;

export function FlexDeckModal({ wallet, onClose }: FlexDeckModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'copied' | 'error'>('loading');
  const [rareCards, setRareCards] = useState<RareCards | null>(null);

  // Load rare cards lookup
  useEffect(() => {
    fetch('/data/rare-cards.json')
      .then(r => r.json())
      .then(setRareCards)
      .catch(() => setRareCards({}));
  }, []);

  // Generate card image once data is ready
  const generateCard = useCallback(async () => {
    if (!rareCards || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    canvas.width = CARD_W;
    canvas.height = CARD_H;

    // Determine which card image to use
    const handle = wallet.xHandle?.toLowerCase();
    const cardUrl = (handle && rareCards[handle]) || XEET_RARE_URL;

    try {
      // Load the card base image
      const img = await loadImage(cardUrl);

      // Draw the card base (scaled to fill canvas)
      ctx.drawImage(img, 0, 0, CARD_W, CARD_H);

      // Semi-transparent overlay at the bottom for the score
      const overlayH = 220;
      const overlayY = CARD_H - overlayH;

      // Gradient overlay from transparent to dark
      const grad = ctx.createLinearGradient(0, overlayY - 50, 0, overlayY + 30);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, overlayY - 50, CARD_W, 80);

      // Dark background for text area — card name can show through faintly
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillRect(0, overlayY + 30, CARD_W, overlayH);

      // "DECK REACH SCORE" label
      ctx.fillStyle = '#E53935';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.letterSpacing = '4px';
      ctx.fillText('DECK REACH SCORE', CARD_W / 2, overlayY + 50);
      ctx.letterSpacing = '0px';

      // Score percentage — large, pushed down into handle area
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 80px sans-serif';
      ctx.fillText(`${wallet.score}%`, CARD_W / 2, overlayY + 120);

      // "X / 391 creators reachable"
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '28px sans-serif';
      ctx.fillText(
        `${wallet.totalReach} / 391 creators reachable`,
        CARD_W / 2,
        overlayY + 170,
      );

      // Convert to blob
      canvas.toBlob(
        blob => {
          if (blob) {
            setImageBlob(blob);
            setImageUrl(URL.createObjectURL(blob));
            setStatus('ready');
          } else {
            setStatus('error');
          }
        },
        'image/png',
      );
    } catch {
      setStatus('error');
    }
  }, [rareCards, wallet]);

  useEffect(() => {
    if (rareCards) generateCard();
  }, [rareCards, generateCard]);

  // Cleanup object URL
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
      // Fallback: download
      downloadImage();
    }
  };

  const downloadImage = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    const name = wallet.xHandle || 'deck-score';
    a.download = `${name}-deck-score.png`;
    a.click();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative mx-4 max-w-md w-full rounded-2xl p-6"
        style={{ background: 'rgba(15, 15, 15, 0.98)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-500 hover:text-white transition-colors text-xl leading-none"
        >
          &times;
        </button>

        <h3 className="text-lg font-bold mb-4">Flex Your Deck</h3>

        {/* Hidden canvas for generation */}
        <canvas ref={canvasRef} className="hidden" />

        {/* Preview */}
        <div className="rounded-xl overflow-hidden mb-4 bg-black flex items-center justify-center"
          style={{ minHeight: 300 }}
        >
          {status === 'loading' && (
            <p className="text-gray-500 text-sm">Generating card...</p>
          )}
          {status === 'error' && (
            <p className="text-red-400 text-sm">Failed to generate card. Try again.</p>
          )}
          {imageUrl && (
            <img
              src={imageUrl}
              alt="Deck Score Card"
              className="w-full h-auto"
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={copyToClipboard}
            disabled={status === 'loading' || status === 'error'}
            className="flex-1 rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-40"
            style={{
              background: status === 'copied' ? '#1D9E75' : '#E53935',
              color: '#fff',
            }}
          >
            {status === 'copied' ? 'Copied!' : 'Copy to Clipboard'}
          </button>
          <button
            onClick={downloadImage}
            disabled={status === 'loading' || status === 'error'}
            className="rounded-xl px-4 py-3 text-sm font-semibold text-gray-300 transition-colors hover:text-white disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            Download
          </button>
        </div>

        <p className="text-[11px] text-gray-600 mt-3 text-center">
          Paste directly into a tweet — image is on your clipboard
        </p>
      </div>
    </div>
  );
}

// ─── Helper ─────────────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
