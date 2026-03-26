import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Xeet Creator Cards — Market Intelligence',
  description: 'Live listings, prices, and alerts for Xeet Creator Cards across all marketplaces',
};

export default function MarketLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold tracking-tight">
              <Link href="/">Xeet Creator Cards</Link>
              <span className="text-gray-500 font-normal ml-2 text-sm">Market Intel</span>
            </h1>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/deck" className="text-gray-400 hover:text-gray-100 transition-colors">
                Deck Score
              </Link>
            </nav>
          </div>
        </div>
      </header>
      <main className="max-w-screen-2xl mx-auto px-6 py-6">{children}</main>
    </>
  );
}
