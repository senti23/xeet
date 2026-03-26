import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Deck Reach Score — Xeet Creator Cards',
  description: 'Measure how many creators your card collection can reach through XCC holdings',
};

export default function DeckLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-deck-bg">
      <header className="border-b border-deck-border px-6 py-4">
        <div className="max-w-screen-2xl mx-auto">
          <h1 className="text-xl font-bold tracking-tight">
            Deck Reach Score
            <span className="text-gray-500 font-normal ml-2 text-sm">Xeet Creator Cards</span>
          </h1>
        </div>
      </header>
      <main className="max-w-screen-2xl mx-auto px-6 py-6">{children}</main>
    </div>
  );
}
