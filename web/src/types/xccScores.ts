export type Tier = 'Mythic' | 'Legendary' | 'Epic' | 'Rare' | 'Common';

export interface CreatorScore {
  xHandle: string;
  displayName: string;
  tier: Tier;
  tierColor: string; // present in JSON but ignored — we hardcode TIER_COLORS
  rank: number;
  compositeScore: number;
  dimensions: {
    performance: number;
    market: number;
    ecosystem: number;
    reach: number;
  };
  signals: Record<string, number | string | null>;
}

export const TIER_COLORS: Record<Tier, string> = {
  Mythic: '#EF9F27',
  Legendary: '#D85A30',
  Epic: '#7F77DD',
  Rare: '#378ADD',
  Common: '#888780',
};

export const TIER_BORDER_WIDTH: Record<Tier, number> = {
  Mythic: 4,
  Legendary: 3.4,
  Epic: 2.8,
  Rare: 2.2,
  Common: 1.8,
};

export const TIER_ORDER: Tier[] = ['Mythic', 'Legendary', 'Epic', 'Rare', 'Common'];

// Per-card weighting used by the Deck Strength score on /deck.
// Shared between DeckStrengthLeaderboard, DeckDetailsCard, DeckShareCard,
// and the backend compute-deck-scores.ts.
//
// Deck Strength = Σ  TIER_WEIGHT[creator.tier] × RARITY_WEIGHT[card.rarity] × quantity
//
// Creator tier reflects quality (composite xeet score); card rarity
// reflects scarcity (on-chain supply). The product captures both.
export const TIER_WEIGHT: Record<Tier, number> = {
  Mythic: 5,
  Legendary: 3,
  Epic: 2,
  Rare: 1,
  Common: 0.5,
};

// Rarity multiplier — conservatively dampened from actual supply ratios:
//   Actual median supply: legendary ~1, rare ~13, common ~70 per creator.
//   Raw inverse-supply: legendary ~70×, rare ~5.4×, common 1×.
//   We use ≈ sqrt(inverse) rounded: 5 / 2 / 1.
// This keeps both dimensions (tier quality + rarity scarcity) in play
// without letting legendaries dominate the score entirely.
export type CardRarity = 'legendary' | 'rare' | 'common';

export const RARITY_WEIGHT: Record<CardRarity, number> = {
  legendary: 5,
  rare: 2,
  common: 1,
};
