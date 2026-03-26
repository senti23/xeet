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
