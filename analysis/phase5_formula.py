"""Phase 5: Formula Proposal — Dimensions, weights, tiers, top/bottom 30."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import numpy as np
from scipy.stats import rankdata
from config import *


# ===================================================================
# FORMULA DEFINITION (grounded in Phase 2-4 findings)
# ===================================================================

DIMENSIONS = {
    "performance": {
        "weight": 0.42,
        "description": "Competitive tournament quality and consistency",
        "signals": [
            {"name": "avgDifficultyAdjustedPercentile", "weight": 0.35, "inverted": False,
             "description": "Average percentile across competitive entries (quality per tournament)"},
            {"name": "organicXeetsCompetitive", "weight": 0.25, "inverted": False,
             "description": "Organic XEETS (signal+noise, no bonus) across competitive entries"},
            {"name": "competitiveTournamentCount", "weight": 0.25, "inverted": False,
             "description": "Number of competitive tournament entries"},
            {"name": "signalRatioAvg", "weight": 0.15, "inverted": False,
             "description": "Content quality (signal vs noise ratio)"},
        ],
    },
    "ecosystem": {
        "weight": 0.23,
        "description": "Ecosystem alignment and skin-in-the-game",
        "signals": [
            {"name": "deckReachScore", "weight": 0.35, "inverted": False,
             "description": "Deck reach score (network value via card holdings)"},
            {"name": "totalCardsHeld", "weight": 0.30, "inverted": False,
             "description": "Total XCC cards held from other creators (ecosystem investment)"},
            {"name": "multiplierBreadth", "weight": 0.20, "inverted": False,
             "description": "Cross-project alignment (held NFTs, used products across projects)"},
            {"name": "cryptoCreatorXeets", "weight": 0.15, "inverted": False,
             "description": "XEETS in Crypto Creator tournament (standalone quality signal)"},
        ],
    },
    "reach": {
        "weight": 0.20,
        "description": "Efficiency and breadth of influence",
        "signals": [
            {"name": "followers", "weight": 0.35, "inverted": False,
             "description": "X (Twitter) follower count — raw audience size"},
            {"name": "xpf", "weight": 0.35, "inverted": False,
             "description": "XEETS Per Follower — efficiency of audience conversion"},
            {"name": "nicheDiversity", "weight": 0.30, "inverted": False,
             "description": "Number of distinct tournament niches"},
        ],
    },
    "market": {
        "weight": 0.15,
        "description": "Market agreement indicator (does the market see it too?)",
        "signals": [
            {"name": "osFloorCommon", "weight": 0.25, "inverted": False,
             "description": "OpenSea floor price (common, ETH)"},
            {"name": "ethSaleVolume", "weight": 0.25, "inverted": False,
             "description": "Total ETH trading volume"},
            {"name": "highestSaleCommon", "weight": 0.20, "inverted": False,
             "description": "Highest sale price (common, ETH)"},
            {"name": "priceTrajectory", "weight": 0.15, "inverted": False,
             "description": "Price momentum (slope of last 10 sales)"},
            {"name": "saleVelocity30d", "weight": 0.15, "inverted": False,
             "description": "Recent 30-day sale count"},
        ],
    },
}


def rank_normalize(series):
    """Rank-based normalization to 0-100. Handles nulls."""
    result = pd.Series(np.nan, index=series.index)
    valid = series.dropna()
    if len(valid) == 0:
        return result
    ranks = rankdata(valid.values, method="average")
    # Normalize to 0-100
    normalized = (ranks - 1) / (len(ranks) - 1) * 100 if len(ranks) > 1 else np.full(len(ranks), 50.0)
    result.loc[valid.index] = normalized
    return result


def compute_dimension_score(df, dimension_config):
    """Compute a single dimension score (0-100) from its component signals."""
    scores = pd.DataFrame(index=df.index)
    total_weight = 0

    for sig in dimension_config["signals"]:
        name = sig["name"]
        if name not in df.columns:
            continue
        weight = sig["weight"]

        # Rank-normalize the signal (handles skewed distributions better than min-max)
        normalized = rank_normalize(df[name])

        # Invert if needed (lower = better, like rank)
        if sig.get("inverted", False):
            normalized = 100 - normalized

        scores[name] = normalized * weight
        total_weight += weight

    # Weighted sum, rescaled
    if total_weight > 0:
        return scores.sum(axis=1) / total_weight
    return pd.Series(0, index=df.index)


def main():
    print("=" * 70)
    print("PHASE 5: FORMULA PROPOSAL")
    print("=" * 70)

    df = pd.read_parquet(OUTPUT_DIR / "unified_creators.parquet")
    print(f"Loaded {len(df)} creators\n")

    # --- Compute XPF (XEETS Per Follower) ---
    # Small engaged audience > large passive one
    df["xpf"] = df.apply(
        lambda r: r["totalXeetsExclXeetsgiving"] / r["followers"]
        if pd.notna(r["followers"]) and r["followers"] > 0 else None,
        axis=1,
    )
    xpf_valid = df["xpf"].dropna()
    print(f"XPF (XEETS Per Follower) computed: mean={xpf_valid.mean():.4f}, median={xpf_valid.median():.4f}")
    print(f"  Top XPF: {df.nlargest(5, 'xpf')[['xHandle','xpf','totalXeetsExclXeetsgiving','followers']].to_string(index=False)}")
    print()

    # --- Compute Dimension Scores ---
    print("Computing dimension scores...\n")
    for dim_name, dim_config in DIMENSIONS.items():
        df[f"dim_{dim_name}"] = compute_dimension_score(df, dim_config)
        print(f"  {dim_name:<15s} (weight={dim_config['weight']}) — "
              f"mean={df[f'dim_{dim_name}'].mean():.1f}, "
              f"median={df[f'dim_{dim_name}'].median():.1f}, "
              f"std={df[f'dim_{dim_name}'].std():.1f}")

    # --- Performance Confidence Multiplier ---
    # Discount thin track records: fewer competitive entries = less confidence in percentile
    def confidence_mult(n):
        if n >= 8: return 1.0
        if n >= 5: return 0.9
        if n >= 3: return 0.8
        if n >= 1: return 0.7
        return 0.0

    df["confidenceMultiplier"] = df["competitiveTournamentCount"].apply(confidence_mult)
    df["dim_performance"] = df["dim_performance"] * df["confidenceMultiplier"]
    conf_dist = df["confidenceMultiplier"].value_counts().sort_index()
    print(f"\n  Performance confidence multiplier applied:")
    for mult, count in conf_dist.items():
        print(f"    {mult:.1f}x: {count} creators")

    # --- Composite Score ---
    df["compositeScore"] = sum(
        df[f"dim_{name}"] * config["weight"]
        for name, config in DIMENSIONS.items()
    )

    # Rank
    df["rank"] = df["compositeScore"].rank(ascending=False, method="min").astype(int)

    print(f"\n  Composite score: mean={df['compositeScore'].mean():.1f}, "
          f"median={df['compositeScore'].median():.1f}, "
          f"std={df['compositeScore'].std():.1f}")

    # --- Tier Assignment ---
    # 5 tiers using natural k=3 clusters as anchors + percentile splits within the large cluster
    # Target sizes: Mythic ~25, Legendary ~50, Epic ~75, Rare ~110, Common ~130
    # That's roughly: top 6.4%, next 12.8%, next 19.2%, next 28.1%, bottom 33.2%
    tier_boundaries = [
        ("Mythic", 93.6),     # top ~25 creators
        ("Legendary", 80.8),  # next ~50 creators
        ("Epic", 61.6),       # next ~75 creators
        ("Rare", 33.5),       # next ~110 creators
        ("Common", 0),        # bottom ~131 creators
    ]

    def assign_tier(score, all_scores):
        pctile = (all_scores < score).mean() * 100
        for tier_name, threshold in tier_boundaries:
            if pctile >= threshold:
                return tier_name
        return "Common"

    all_scores = df["compositeScore"]
    df["tier"] = df["compositeScore"].apply(lambda s: assign_tier(s, all_scores))

    tier_counts = df["tier"].value_counts()
    print(f"\n--- Tier Distribution ---")
    for tier_name, _ in tier_boundaries:
        count = tier_counts.get(tier_name, 0)
        tier_df = df[df["tier"] == tier_name]
        avg_score = tier_df["compositeScore"].mean()
        avg_perf = tier_df["dim_performance"].mean()
        avg_market = tier_df["dim_market"].mean()
        avg_floor = tier_df["osFloorCommon"].mean()
        floor_str = f"{avg_floor:.4f}" if pd.notna(avg_floor) else "N/A"
        print(f"  {tier_name:<12s}: {count:>4d} creators | score={avg_score:>5.1f} | "
              f"perf={avg_perf:>5.1f} | market={avg_market:>5.1f} | "
              f"avg floor={floor_str} ETH")

    # --- Top 30 ---
    print("\n" + "=" * 70)
    print("TOP 30 CREATORS BY COMPOSITE SCORE")
    print("=" * 70)
    top30 = df.nlargest(30, "compositeScore")
    print(f"{'Rk':>3s} {'Handle':<22s} {'Tier':<10s} {'Score':>6s} {'Perf':>6s} {'Eco':>6s} {'Reach':>6s} {'Mkt':>6s} {'XEETS':>8s} {'OSFloor':>10s} {'CompT':>5s}")
    print("-" * 105)
    for _, r in top30.iterrows():
        floor = f"{r['osFloorCommon']:.4f}" if pd.notna(r['osFloorCommon']) else "N/A"
        print(f"  {r['rank']:>2d} {r['xHandle']:<22s} {r['tier']:<10s} {r['compositeScore']:>6.1f} "
              f"{r['dim_performance']:>6.1f} {r['dim_ecosystem']:>6.1f} {r['dim_reach']:>6.1f} {r['dim_market']:>6.1f} "
              f"{r['totalXeetsExclXeetsgiving']:>8.0f} {floor:>10s} {r['competitiveTournamentCount']:>5.0f}")

    # --- Bottom 30 ---
    print("\n" + "=" * 70)
    print("BOTTOM 30 CREATORS BY COMPOSITE SCORE")
    print("=" * 70)
    bottom30 = df.nsmallest(30, "compositeScore")
    print(f"{'Rk':>3s} {'Handle':<22s} {'Tier':<10s} {'Score':>6s} {'Perf':>6s} {'Eco':>6s} {'Reach':>6s} {'Mkt':>6s} {'XEETS':>8s}")
    print("-" * 85)
    for _, r in bottom30.iterrows():
        print(f"  {r['rank']:>2d} {r['xHandle']:<22s} {r['tier']:<10s} {r['compositeScore']:>6.1f} "
              f"{r['dim_performance']:>6.1f} {r['dim_ecosystem']:>6.1f} {r['dim_reach']:>6.1f} {r['dim_market']:>6.1f} "
              f"{r['totalXeetsExclXeetsgiving']:>8.0f}")

    # --- Gut-Feel Mythic Candidates ---
    print("\n" + "=" * 70)
    print("GUT-FEEL MYTHIC CANDIDATES — FORMULA RESULTS")
    print("=" * 70)
    print(f"{'Handle':<20s} {'Rk':>4s} {'Tier':<10s} {'Score':>6s} {'Perf':>6s} {'Eco':>6s} {'Reach':>6s} {'Mkt':>6s}")
    print("-" * 75)
    for candidate in MYTHIC_CANDIDATES:
        match = df[df["xHandle"].str.lower() == candidate.lower()]
        if len(match) == 0:
            print(f"  {candidate:<20s} NOT FOUND")
            continue
        r = match.iloc[0]
        print(f"  {r['xHandle']:<20s} {r['rank']:>4d} {r['tier']:<10s} {r['compositeScore']:>6.1f} "
              f"{r['dim_performance']:>6.1f} {r['dim_ecosystem']:>6.1f} {r['dim_reach']:>6.1f} {r['dim_market']:>6.1f}")

    # --- Surprises ---
    print("\n" + "=" * 70)
    print("SURPRISES: Tier vs Market Price Mismatches")
    print("=" * 70)

    # Cheap Mythics (Mythic tier but bottom 50% floor price)
    median_floor = df["osFloorCommon"].median()
    mythics = df[df["tier"] == "Mythic"]
    cheap_mythics = mythics[mythics["osFloorCommon"] <= median_floor]
    if len(cheap_mythics) > 0:
        print(f"\n  CHEAP MYTHICS (Mythic tier, floor <= {median_floor:.4f} ETH median):")
        for _, r in cheap_mythics.sort_values("compositeScore", ascending=False).iterrows():
            floor = f"{r['osFloorCommon']:.4f}" if pd.notna(r['osFloorCommon']) else "N/A"
            print(f"    {r['xHandle']:<22s} score={r['compositeScore']:.1f} floor={floor} XEETS={r['totalXeetsExclXeetsgiving']:.0f}")

    # Expensive Commons (Common/Rare tier but top 25% floor price)
    p75_floor = df["osFloorCommon"].quantile(0.75)
    low_tiers = df[df["tier"].isin(["Common", "Rare"])]
    expensive_low = low_tiers[low_tiers["osFloorCommon"] >= p75_floor]
    if len(expensive_low) > 0:
        print(f"\n  EXPENSIVE LOW-TIERS ({p75_floor:.4f}+ ETH floor but Common/Rare tier):")
        for _, r in expensive_low.sort_values("osFloorCommon", ascending=False).head(15).iterrows():
            floor = f"{r['osFloorCommon']:.4f}" if pd.notna(r['osFloorCommon']) else "N/A"
            print(f"    {r['xHandle']:<22s} tier={r['tier']:<8s} score={r['compositeScore']:.1f} floor={floor} XEETS={r['totalXeetsExclXeetsgiving']:.0f}")

    # --- Formula Summary ---
    print("\n" + "=" * 70)
    print("THE XEET CO-EFFICIENT v4")
    print("=" * 70)
    print(f"""
Composite = P*0.42 + A*0.23 + R*0.20 + M*0.15

  P (Performance, 42%):
    - avgDifficultyAdjustedPerc  (35%)  — quality per tournament
    - totalXeetsExclXeetsgiving  (25%)  — earning power
    - competitiveTournamentCount (25%)  — consistency
    - signalRatioAvg             (15%)  — content quality (sole quality signal)

  A (Ecosystem Alignment, 23%):
    - deckReachScore             (35%)  — network value via card holdings
    - ownCardsHeld               (30%)  — skin in the game
    - multiplierBreadth          (20%)  — cross-project alignment (moved from P)
    - cryptoCreatorXeets         (15%)  — standalone quality signal

  R (Reach/Efficiency, 20%):
    - followers                  (35%)  — raw audience size
    - XPF (XEETS/followers)      (35%)  — audience efficiency
    - nicheDiversity             (30%)  — breadth across niches

  M (Market, 15%):
    - osFloorCommon              (25%)  — current valuation
    - ethSaleVolume              (25%)  — market activity
    - highestSaleCommon          (20%)  — peak demand
    - priceTrajectory            (15%)  — price momentum
    - saleVelocity30d            (15%)  — recent demand
""")

    # Save scored data
    df.to_parquet(OUTPUT_DIR / "scored_creators.parquet", index=False)
    scored_csv = OUTPUT_DIR / "scored_creators.csv"
    save_cols = ["rank", "xHandle", "displayName", "tier", "compositeScore",
                 "dim_performance", "dim_market", "dim_ecosystem", "dim_reach",
                 "totalXeetsExclXeetsgiving", "competitiveTournamentCount",
                 "avgDifficultyAdjustedPercentile", "signalRatioAvg",
                 "osFloorCommon", "ethSaleVolume", "highestSaleCommon",
                 "deckReachScore", "followers"]
    df[save_cols].sort_values("rank").to_csv(scored_csv, index=False)
    print(f"Saved scored data to {scored_csv}")


if __name__ == "__main__":
    main()
