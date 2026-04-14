"""Phase 3: Correlation Analysis — Find redundancies, independent dimensions, and market-performance gap."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import numpy as np
from scipy import stats as scipy_stats
from config import *


# Signals to analyze (exclude known noise from Phase 2)
ANALYSIS_SIGNALS = [
    # Performance
    "totalXeetsExclXeetsgiving",
    "avgDifficultyAdjustedPercentile",
    "signalRatioAvg",
    "cryptoCreatorRank",      # inverted (lower = better)
    "cryptoCreatorXeets",
    "multiplierBreadth",
    "competitiveTournamentCount",
    "nicheDiversity",
    "bestRank",               # inverted
    # Market
    "osFloorCommon",
    "osFloorRare",
    "ethSaleVolume",
    "ethSaleCount",
    "highestSaleCommon",
    "highestSaleRare",
    "priceTrajectory",
    "rarityPremiumRatio",
    "saleVelocity30d",
    # Activity
    "ownCardsHeld",
    "deckReachScore",
    "followers",
]


def main():
    print("=" * 70)
    print("PHASE 3: CORRELATION ANALYSIS")
    print("=" * 70)

    df = pd.read_parquet(OUTPUT_DIR / "unified_creators.parquet")

    # Select analysis columns, flip inverted signals for correlation
    analysis_df = df[["xHandle"] + [c for c in ANALYSIS_SIGNALS if c in df.columns]].copy()

    # Flip inverted signals so higher = better for all
    if "cryptoCreatorRank" in analysis_df.columns:
        max_rank = analysis_df["cryptoCreatorRank"].max()
        analysis_df["cryptoCreatorRank_inv"] = max_rank - analysis_df["cryptoCreatorRank"]
    if "bestRank" in analysis_df.columns:
        max_rank = analysis_df["bestRank"].max()
        analysis_df["bestRank_inv"] = max_rank - analysis_df["bestRank"]

    # Use inverted versions for correlation
    corr_cols = [c for c in ANALYSIS_SIGNALS if c in df.columns and c not in ("cryptoCreatorRank", "bestRank")]
    if "cryptoCreatorRank_inv" in analysis_df.columns:
        corr_cols.append("cryptoCreatorRank_inv")
    if "bestRank_inv" in analysis_df.columns:
        corr_cols.append("bestRank_inv")

    numeric_df = analysis_df[corr_cols]

    # --- Spearman Correlation (robust to non-normal distributions) ---
    print("\n--- Spearman Rank Correlation Matrix ---")
    spearman_corr = numeric_df.corr(method="spearman")

    # --- Find redundant pairs (|r| > 0.75) ---
    print("\n" + "=" * 70)
    print("REDUNDANT SIGNAL PAIRS (|Spearman r| > 0.75)")
    print("=" * 70)
    print("These signals carry overlapping information — consider keeping only one.\n")

    redundant = []
    for i, c1 in enumerate(corr_cols):
        for c2 in corr_cols[i+1:]:
            r = spearman_corr.loc[c1, c2]
            if abs(r) > 0.75:
                redundant.append((c1, c2, r))

    redundant.sort(key=lambda x: abs(x[2]), reverse=True)
    print(f"{'Signal A':<40s} {'Signal B':<40s} {'r':>8s}")
    print("-" * 90)
    for a, b, r in redundant:
        print(f"  {a:<40s} {b:<40s} {r:>8.3f}")

    # --- Find independent signals (|r| < 0.30 with most others) ---
    print("\n" + "=" * 70)
    print("SIGNAL INDEPENDENCE (avg |r| with all other signals)")
    print("=" * 70)
    print("Lower avg = more independent = captures unique information\n")

    avg_abs_corr = spearman_corr.abs().mean().sort_values()
    print(f"{'Signal':<40s} {'Avg |r|':>8s} {'Independence':<15s}")
    print("-" * 65)
    for col, avg_r in avg_abs_corr.items():
        ind = "INDEPENDENT" if avg_r < 0.30 else "moderate" if avg_r < 0.45 else "correlated"
        print(f"  {col:<40s} {avg_r:>8.3f} {ind:<15s}")

    # --- Market-Performance Gap Analysis ---
    print("\n" + "=" * 70)
    print("MARKET-PERFORMANCE GAP ANALYSIS")
    print("=" * 70)
    print("Positive residual = overpriced (market values > performance justifies)")
    print("Negative residual = UNDERPRICED (alpha opportunity)\n")

    # Use totalXeetsExclXeetsgiving as primary performance proxy (highest CV among performance signals)
    # and osFloorCommon as market proxy
    perf_col = "totalXeetsExclXeetsgiving"
    market_col = "osFloorCommon"

    gap_df = df[["xHandle", perf_col, market_col]].dropna()

    # Log-transform both (they're right-skewed)
    gap_df = gap_df[gap_df[perf_col] > 0].copy()
    gap_df["log_perf"] = np.log1p(gap_df[perf_col])
    gap_df["log_market"] = np.log1p(gap_df[market_col])

    # Linear fit
    slope, intercept, r_value, p_value, std_err = scipy_stats.linregress(
        gap_df["log_perf"], gap_df["log_market"]
    )
    gap_df["predicted_log_market"] = slope * gap_df["log_perf"] + intercept
    gap_df["residual"] = gap_df["log_market"] - gap_df["predicted_log_market"]

    print(f"Linear fit (log scale): r={r_value:.3f}, r^2={r_value**2:.3f}, p={p_value:.2e}")
    print(f"Slope: {slope:.4f}, Intercept: {intercept:.4f}")

    if r_value**2 < 0.1:
        print("\n*** WEAK CORRELATION: Market price barely reflects performance! ***")
        print("*** This means the market is mostly pricing on OTHER factors (name, rarity, hype) ***")
        print("*** HUGE alpha opportunity for performance-based formula ***")

    # Top 20 underpriced (best performance relative to price)
    underpriced = gap_df.nsmallest(20, "residual")
    print(f"\n--- Top 20 UNDERPRICED (performance >> market price) ---")
    print(f"{'Handle':<22s} {'XEETS':>8s} {'OS Floor':>10s} {'Residual':>9s} {'Gap Signal':<15s}")
    print("-" * 70)
    for _, r in underpriced.iterrows():
        gap_sig = "STRONG BUY" if r["residual"] < -0.5 else "underpriced"
        print(f"  {r['xHandle']:<22s} {r[perf_col]:>8.0f} {r[market_col]:>10.4f} {r['residual']:>9.3f} {gap_sig:<15s}")

    # Top 20 overpriced
    overpriced = gap_df.nlargest(20, "residual")
    print(f"\n--- Top 20 OVERPRICED (market price >> performance) ---")
    print(f"{'Handle':<22s} {'XEETS':>8s} {'OS Floor':>10s} {'Residual':>9s}")
    print("-" * 60)
    for _, r in overpriced.iterrows():
        print(f"  {r['xHandle']:<22s} {r[perf_col]:>8.0f} {r[market_col]:>10.4f} {r['residual']:>9.3f}")

    # --- Additional market gap: highestSaleCommon vs performance ---
    print(f"\n--- Highest Sale Common vs Performance ---")
    gap2 = df[["xHandle", perf_col, "highestSaleCommon"]].dropna()
    gap2 = gap2[gap2[perf_col] > 0].copy()
    if len(gap2) > 10:
        r_val, p_val = scipy_stats.spearmanr(gap2[perf_col], gap2["highestSaleCommon"])
        print(f"Spearman r: {r_val:.3f} (p={p_val:.2e})")

    print(f"\n--- Price Trajectory vs Performance ---")
    gap3 = df[["xHandle", perf_col, "priceTrajectory"]].dropna()
    gap3 = gap3[gap3[perf_col] > 0].copy()
    if len(gap3) > 10:
        r_val, p_val = scipy_stats.spearmanr(gap3[perf_col], gap3["priceTrajectory"])
        print(f"Spearman r: {r_val:.3f} (p={p_val:.2e})")

    print(f"\n--- Sale Velocity 30d vs Performance ---")
    gap4 = df[["xHandle", perf_col, "saleVelocity30d"]].dropna()
    gap4 = gap4[gap4[perf_col] > 0].copy()
    if len(gap4) > 10:
        r_val, p_val = scipy_stats.spearmanr(gap4[perf_col], gap4["saleVelocity30d"])
        print(f"Spearman r: {r_val:.3f} (p={p_val:.2e})")

    print(f"\n--- Buyer Concentration vs Performance ---")
    gap5 = df[["xHandle", perf_col, "buyerConcentration"]].dropna()
    gap5 = gap5[gap5[perf_col] > 0].copy()
    if len(gap5) > 10:
        r_val, p_val = scipy_stats.spearmanr(gap5[perf_col], gap5["buyerConcentration"])
        print(f"Spearman r: {r_val:.3f} (p={p_val:.2e})")

    print(f"\n--- Rarity Premium Ratio vs Performance ---")
    gap6 = df[["xHandle", perf_col, "rarityPremiumRatio"]].dropna()
    gap6 = gap6[gap6[perf_col] > 0].copy()
    if len(gap6) > 10:
        r_val, p_val = scipy_stats.spearmanr(gap6[perf_col], gap6["rarityPremiumRatio"])
        print(f"Spearman r: {r_val:.3f} (p={p_val:.2e})")

    # --- Gut-Feel Mythic Profile ---
    print("\n" + "=" * 70)
    print("GUT-FEEL MYTHIC CANDIDATE PROFILES")
    print("=" * 70)

    mythic_handles = [h.lower() for h in MYTHIC_CANDIDATES]
    mythic_df = df[df["xHandle"].str.lower().isin(mythic_handles)]

    profile_cols = [
        "totalXeetsExclXeetsgiving", "competitiveTournamentCount",
        "avgDifficultyAdjustedPercentile", "signalRatioAvg",
        "cryptoCreatorXeets", "multiplierBreadth",
        "osFloorCommon", "ethSaleVolume", "highestSaleCommon",
        "priceTrajectory", "saleVelocity30d",
        "ownCardsHeld", "deckReachScore", "followers",
    ]

    print(f"\n{'Handle':<18s}", end="")
    for col in profile_cols:
        short = col[:12]
        print(f" {short:>12s}", end="")
    print()
    print("-" * (18 + 13 * len(profile_cols)))

    for _, r in mythic_df.iterrows():
        print(f"  {r['xHandle']:<18s}", end="")
        for col in profile_cols:
            v = r[col]
            if pd.isna(v):
                print(f" {'N/A':>12s}", end="")
            elif abs(v) >= 100:
                print(f" {v:>12,.0f}", end="")
            elif abs(v) >= 1:
                print(f" {v:>12.2f}", end="")
            else:
                print(f" {v:>12.4f}", end="")
        print()

    # Mythics vs non-Mythics comparison
    non_mythic_df = df[~df["xHandle"].str.lower().isin(mythic_handles)]
    print(f"\n--- Mythic vs Non-Mythic Averages ---")
    print(f"{'Signal':<40s} {'Mythic Mean':>14s} {'Non-Mythic Mean':>16s} {'Ratio':>8s}")
    print("-" * 80)
    for col in profile_cols:
        m_mean = mythic_df[col].mean()
        nm_mean = non_mythic_df[col].mean()
        ratio = m_mean / nm_mean if nm_mean and nm_mean != 0 else None
        ratio_str = f"{ratio:.1f}x" if ratio else "N/A"
        m_str = f"{m_mean:,.2f}" if pd.notna(m_mean) else "N/A"
        nm_str = f"{nm_mean:,.2f}" if pd.notna(nm_mean) else "N/A"
        print(f"  {col:<40s} {m_str:>14s} {nm_str:>16s} {ratio_str:>8s}")

    # --- Proposed Candidate Dimensions ---
    print("\n" + "=" * 70)
    print("PROPOSED CANDIDATE DIMENSIONS FOR CLUSTERING")
    print("=" * 70)
    print("""
Based on correlation and discriminating power analysis:

DIMENSION 1: PERFORMANCE (competitive quality)
  - totalXeetsExclXeetsgiving (CV=1.25, captures earning power)
  - bestRank_inv (CV=2.37, captures peak ability)
  - competitiveTournamentCount (CV=0.85, captures consistency)
  Note: avgDifficultyAdjustedPercentile has low CV (0.08) — ceiling effect.
        Will use rank-based transform in clustering.

DIMENSION 2: MARKET VALUATION
  - osFloorCommon (CV=1.52, current market price)
  - ethSaleVolume (CV=2.18, total market activity)
  - highestSaleCommon (CV=1.51, peak demand signal)
  - priceTrajectory (CV=6.0, momentum)

DIMENSION 3: ENGAGEMENT / ACTIVITY
  - multiplierBreadth (CV=2.07, cross-project depth)
  - ownCardsHeld (CV=1.31, skin in the game)
  - deckReachScore (CV=0.58, network value)

DIMENSION 4: REACH / VISIBILITY
  - followers (CV=1.38, social reach)
  - cryptoCreatorXeets (CV=0.94, content quality in flagship tournament)

SIGNALS TO DROP:
  - collectorDensity (CV=0.09, nearly flat)
  - ethosScore (CV=0.15, no differentiation)
  - buyerConcentration (CV=0.13, nearly flat)
  - uniqueBuyers (CV=0.30, low differentiation)
  - ethSaleCount (CV=0.35, too uniform across creators)
""")

    # Save residuals for use in clustering
    gap_df[["xHandle", "residual"]].to_csv(OUTPUT_DIR / "market_performance_gap.csv", index=False)
    print(f"Saved market-performance gap data to {OUTPUT_DIR / 'market_performance_gap.csv'}")


if __name__ == "__main__":
    main()
