import { DeckPageClient } from '@/components/deck/DeckPageClient';

export const metadata = {
  title: 'Deck Reach Score — Xeet Creator Cards',
  description: 'Measure how many creators your card collection can reach through XCC holdings',
};

// Always-dynamic — page reads ?wallet= from the URL and live API data
export const dynamic = 'force-dynamic';

export default function ReachPage() {
  return <DeckPageClient mode="reach" />;
}
