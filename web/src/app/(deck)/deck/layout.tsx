import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Xeet Deck Tracker — Tier Coverage',
  description: 'Track your Xeet Creator Card collection across all 5 tiers',
};

export default function TrackerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
