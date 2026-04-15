import { DeckNav } from '@/components/deck/DeckNav';

export default function DeckGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-deck-bg">
      <DeckNav />
      <main className="max-w-screen-2xl mx-auto px-6 py-6">{children}</main>
    </div>
  );
}
