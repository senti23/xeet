'use client';

import { useState } from 'react';

const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

function SmallPfp({ src, alt, size = 24 }: { src: string; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="rounded-full bg-gray-800 flex items-center justify-center text-[8px] text-gray-500 shrink-0"
        style={{ width: size, height: size }}
      >
        {alt[0]}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

function IconLink({ href, children, label }: { href: string; children: React.ReactNode; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      className="opacity-50 hover:opacity-100 transition-opacity"
    >
      {children}
    </a>
  );
}

export function DeckCredits() {
  return (
    <div className="hidden lg:flex flex-col gap-1.5 items-end text-right">
      {/* Created by Senti */}
      <div className="flex items-center gap-2">
        <span
          className="text-[13px] text-white/80 italic"
          style={{ fontFamily: 'var(--font-playfair), serif' }}
        >
          Created by <span className="text-[#378ADD]">Senti</span> 🪄
        </span>
        <SmallPfp src="/avatars/senti__23.jpg" alt="Senti" size={22} />
        <div className="flex items-center gap-1.5 text-white">
          <IconLink href="https://mega.etherscan.io/address/0x853e1e59c056da9c3bbf4e780ac0acbfe88d999a" label="Etherscan">
            <span className="text-sm">👛</span>
          </IconLink>
          <IconLink href="https://x.com/Senti__23" label="Twitter">
            <XIcon />
          </IconLink>
        </div>
      </div>

      {/* Inspired by MVC */}
      <div className="flex items-center gap-2">
        <span
          className="text-[11px] text-white/50 italic"
          style={{ fontFamily: 'var(--font-playfair), serif' }}
        >
          Inspired by <span className="text-[#378ADD]/70">MVC</span>
        </span>
        <SmallPfp src="/avatars/man_versus_coin.jpg" alt="MVC" size={18} />
        <div className="flex items-center gap-1.5 text-white">
          <IconLink href="https://xeet.mvc-web.xyz" label="MVC Site">
            <span className="text-xs">⚡</span>
          </IconLink>
          <IconLink href="https://x.com/man_versus_coin" label="Twitter">
            <XIcon />
          </IconLink>
        </div>
      </div>
    </div>
  );
}
