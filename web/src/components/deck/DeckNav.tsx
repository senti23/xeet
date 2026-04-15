'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const tabs = [
  { href: '/deck', label: 'Deck Tracker', sub: 'Tier Coverage' },
  { href: '/reach', label: 'Reach Score', sub: 'Network Bridges' },
];

export function DeckNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const wallet = searchParams.get('wallet');
  const querySuffix = wallet ? `?wallet=${wallet}` : '';

  return (
    <header className="border-b border-deck-border px-6 py-4 bg-[rgba(10,10,10,0.95)] sticky top-0 z-40 backdrop-blur">
      <div className="max-w-screen-2xl mx-auto flex items-center justify-between gap-6 flex-wrap">
        <h1 className="text-xl font-bold tracking-tight">
          <Link href={`/deck${querySuffix}`}>
            Xeet
            <span className="text-gray-500 font-normal ml-2 text-sm">Creator Cards</span>
          </Link>
        </h1>
        <nav className="flex items-center gap-1">
          {tabs.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={`${t.href}${querySuffix}`}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white/[0.08] text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {t.label}
                <span className="hidden md:inline text-[10px] text-gray-600 ml-2 font-normal">
                  {t.sub}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
