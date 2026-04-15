import { DeckPageClient } from '@/components/deck/DeckPageClient';

export const metadata = {
  title: 'Xeet Deck Tracker — Tier Coverage',
  description: 'Track your Xeet Creator Card collection across all 5 tiers — see your deck strength at a glance',
};

// Always-dynamic — page reads ?wallet= from the URL and live API data
export const dynamic = 'force-dynamic';

export default function DeckPage() {
  return <DeckPageClient mode="tracker" />;
}
