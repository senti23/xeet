export interface WalletScoreSummary {
  isXCC: boolean;
  xHandle: string | null;
  displayName: string | null;
  directCount: number;
  secondaryCount: number;
  totalReach: number;
  score: number;
  rankXCC: number | null;
  rankAll: number;
}

export interface DirectHolding {
  creator: string;
  rarity: string; // "common" | "rare" | "legendary"
  quantity: number;
}

export interface WalletScoreDetail {
  direct: DirectHolding[];
  secondary: Record<string, string[]>; // creator -> bridging XCC handles
}

export interface LeaderboardEntry {
  wallet: string;
  handle: string | null;
  displayName: string | null;
  score: number;
  direct: number;
  reach: number;
}

export interface DeckScoresData {
  generated: string;
  totalWallets: number;
  totalCreators: number;
  wallets: Record<string, WalletScoreSummary>;
  leaderboard: {
    xcc: LeaderboardEntry[];
    all: LeaderboardEntry[];
  };
}

export interface CreatorProfile {
  avatar: string;
  xeetBalance: number;
}

export type CreatorProfiles = Record<string, CreatorProfile>;

// ─── Valuation types ─────────────────────────────────────────────────────────

export interface ValuationCard {
  creator: string;
  displayName: string;
  rarity: string;
  quantity: number;
  purchasePriceEth: number | null;
  purchasePriceXeets: number | null;
  highestSaleEth: number | null;
  medianSaleEth: number | null;
  avgSaleEth: number | null;
  saleCount: number;
  currentFloorEth: number | null;
  source: 'sale' | 'floor' | 'no_data';
}

export interface ValuationResponse {
  wallet: string;
  valuation: {
    highest: { totalEth: number; totalUsd: number | null; label: string };
    median: { totalEth: number; totalUsd: number | null; label: string };
    average: { totalEth: number; totalUsd: number | null; label: string };
  };
  costBasis: {
    totalEth: number;
    totalUsd: number | null;
    cardsWithCost: number;
    label: string;
  };
  ethUsdRate: number;
  totalCards: number;
  cardsWithValue: number;
  cardsNoData: number;
  cards: ValuationCard[];
}

// ─── Upgrade types ───────────────────────────────────────────────────────────

export interface UpgradeOpportunity {
  creator: string;
  displayName: string;
  currentRarity: string;
  upgradeRarity: string;
  currentFloorEth: number;
  upgradeFloorEth: number;
  currentFloorUsd: number | null;
  upgradeFloorUsd: number | null;
  ratio: number;
  tier: 'strong_upgrade' | 'decent_upgrade' | 'consider';
}

export interface UpgradesResponse {
  wallet: string;
  ethUsdRate: number;
  totalOpportunities: number;
  opportunities: UpgradeOpportunity[];
}
