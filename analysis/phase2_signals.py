"""Phase 2: Signal Exploration — Compute distributions for all candidate signals."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import numpy as np
from scipy import stats
from config import *


SIGNAL_COLUMNS = [
    # Performance
    "totalXeetsExclXeetsgiving",
    "avgDifficultyAdjustedPercentile",
    "signalRatioAvg",
    "cryptoCreatorRank",
    "cryptoCreatorXeets",
    "multiplierBreadth",
    "competitiveTournamentCount",
    "nicheDiversity",
    "bestRank",
    # Market - floors
    "osFloorCommon",
    "osFloorRare",
    # Market - sales
    "ethSaleVolume",
    "ethSaleCount",
    "uniqueBuyers",
    "highestSaleCommon",
    "highestSaleRare",
    "priceTrajectory",
    "rarityPremiumRatio",
    "saleVelocity30d",
    "buyerConcentration",
    # Activity
    "collectorDensity",
    "ownCardsHeld",
    "deckReachScore",
    "followers",
    "ethosScore",
    "daysSinceLastSale",
]


def classify_shape(series):
    """Classify distribution shape based on skewness and kurtosis."""
    clean = series.dropna()
    if len(clean) < 10:
        return "too_few"
    sk = stats.skew(clean)
    ku = stats.kurtosis(clean)
    if abs(sk) < 0.5 and abs(ku) < 1:
        return "normal-ish"
    elif sk > 1.5:
        return "right-skewed (heavy tail)"
    elif sk > 0.5:
        return "right-skewed"
    elif sk < -1.5:
        return "left-skewed (heavy tail)"
    elif sk < -0.5:
        return "left-skewed"
    elif ku > 3:
        return "heavy-tailed"
    else:
        return "moderate"


def coefficient_of_variation(series):
    """CV = std/mean. Higher = more discriminating."""
    clean = series.dropna()
    if len(clean) == 0 or clean.mean() == 0:
        return None
    return clean.std() / abs(clean.mean())


def main():
    print("=" * 70)
    print("PHASE 2: SIGNAL EXPLORATION")
    print("=" * 70)

    df = pd.read_parquet(OUTPUT_DIR / "unified_creators.parquet")
    print(f"Loaded {len(df)} creators with {len(df.columns)} columns\n")

    # --- Distribution Stats for Each Signal ---
    print(f"{'Signal':<40s} {'N':>5s} {'Null':>5s} {'Mean':>10s} {'Median':>10s} {'Std':>10s} {'CV':>6s} {'Skew':>6s} {'p10':>10s} {'p90':>10s} {'Shape':<25s}")
    print("-" * 160)

    signal_stats = []
    for col in SIGNAL_COLUMNS:
        if col not in df.columns:
            print(f"  {col:<40s} COLUMN NOT FOUND")
            continue

        s = df[col]
        n = s.notna().sum()
        null_count = s.isna().sum()
        null_pct = null_count / len(df) * 100
        clean = s.dropna()

        if n == 0:
            print(f"  {col:<40s} ALL NULL")
            continue

        mean = clean.mean()
        median = clean.median()
        std = clean.std()
        cv = coefficient_of_variation(clean)
        sk = stats.skew(clean) if n >= 3 else 0
        p10 = clean.quantile(0.10)
        p90 = clean.quantile(0.90)
        shape = classify_shape(clean)

        # Format numbers intelligently
        def fmt(v, is_pct=False):
            if pd.isna(v) or v is None:
                return "N/A"
            if abs(v) >= 1000:
                return f"{v:>10,.0f}"
            elif abs(v) >= 1:
                return f"{v:>10.2f}"
            else:
                return f"{v:>10.4f}"

        cv_str = f"{cv:.2f}" if cv is not None else "N/A"

        print(f"  {col:<40s} {n:>5d} {null_count:>4d} {fmt(mean)} {fmt(median)} {fmt(std)} {cv_str:>6s} {sk:>6.2f} {fmt(p10)} {fmt(p90)} {shape:<25s}")

        signal_stats.append({
            "signal": col,
            "n": n,
            "null_count": null_count,
            "null_pct": null_pct,
            "mean": mean,
            "median": median,
            "std": std,
            "cv": cv,
            "skew": sk,
            "p10": p10,
            "p25": clean.quantile(0.25),
            "p50": median,
            "p75": clean.quantile(0.75),
            "p90": p90,
            "p95": clean.quantile(0.95),
            "p99": clean.quantile(0.99),
            "min": clean.min(),
            "max": clean.max(),
            "shape": shape,
        })

    stats_df = pd.DataFrame(signal_stats)

    # --- Discriminating Power Analysis ---
    print("\n" + "=" * 70)
    print("SIGNAL DISCRIMINATING POWER (sorted by Coefficient of Variation)")
    print("=" * 70)
    print("Higher CV = more spread = better for differentiating creators\n")

    ranked = stats_df.dropna(subset=["cv"]).sort_values("cv", ascending=False)
    print(f"{'Rank':>4s} {'Signal':<40s} {'CV':>8s} {'Null%':>6s} {'Verdict':<20s}")
    print("-" * 80)
    for i, (_, r) in enumerate(ranked.iterrows()):
        verdict = ""
        if r["null_pct"] > 50:
            verdict = "TOO SPARSE"
        elif r["cv"] > 2.0:
            verdict = "HIGH (excellent)"
        elif r["cv"] > 1.0:
            verdict = "GOOD"
        elif r["cv"] > 0.5:
            verdict = "MODERATE"
        else:
            verdict = "LOW (flat)"

        print(f"  {i+1:>2d}. {r['signal']:<40s} {r['cv']:>8.2f} {r['null_pct']:>5.1f}% {verdict:<20s}")

    # --- Signals to flag ---
    print("\n" + "=" * 70)
    print("SIGNAL TRIAGE")
    print("=" * 70)

    # High nulls
    sparse = stats_df[stats_df["null_pct"] > 30]
    if len(sparse) > 0:
        print("\nSIGNALS WITH >30% NULLS (consider dropping or special handling):")
        for _, r in sparse.iterrows():
            print(f"  {r['signal']:<40s} {r['null_pct']:.1f}% null")

    # Near-zero variance
    flat = stats_df[stats_df["cv"] < 0.3].dropna(subset=["cv"])
    if len(flat) > 0:
        print("\nSIGNALS WITH LOW CV (<0.3) — limited differentiation:")
        for _, r in flat.iterrows():
            print(f"  {r['signal']:<40s} CV={r['cv']:.2f}")

    # Inverted signals (lower = better)
    print("\nINVERTED SIGNALS (lower = better, will need flipping for scoring):")
    for col in ["cryptoCreatorRank", "bestRank", "avgRankCompetitive", "daysSinceLastSale"]:
        if col in [r["signal"] for _, r in stats_df.iterrows()]:
            print(f"  {col}")

    # --- Detailed percentile table for top signals ---
    print("\n" + "=" * 70)
    print("DETAILED PERCENTILE TABLE (Top 15 signals by discriminating power)")
    print("=" * 70)

    top_signals = ranked.head(15)
    print(f"\n{'Signal':<35s} {'Min':>8s} {'p10':>8s} {'p25':>8s} {'p50':>8s} {'p75':>8s} {'p90':>8s} {'p95':>8s} {'Max':>10s}")
    print("-" * 120)
    for _, r in top_signals.iterrows():
        def fmt2(v):
            if abs(v) >= 100:
                return f"{v:>8,.0f}"
            elif abs(v) >= 1:
                return f"{v:>8.2f}"
            else:
                return f"{v:>8.4f}"
        print(f"  {r['signal']:<35s} {fmt2(r['min'])} {fmt2(r['p10'])} {fmt2(r['p25'])} {fmt2(r['p50'])} {fmt2(r['p75'])} {fmt2(r['p90'])} {fmt2(r['p95'])} {fmt2(r['max'])}")

    # Save stats
    stats_df.to_csv(OUTPUT_DIR / "signal_distributions.csv", index=False)
    print(f"\nSaved signal stats to {OUTPUT_DIR / 'signal_distributions.csv'}")


if __name__ == "__main__":
    main()
