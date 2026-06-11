"""Phase 6: Output Files — Generate xcc-scores.json, formula-config.json, and summary."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import json
import pandas as pd
import numpy as np
from datetime import datetime
from config import *


def _nan_to_null(obj):
    """Recursively convert NaN floats to None so json.dump emits valid JSON."""
    if isinstance(obj, float) and obj != obj:
        return None
    if isinstance(obj, dict):
        return {k: _nan_to_null(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_nan_to_null(v) for v in obj]
    return obj


# Tier colors (matching Xeet rarity aesthetic)
TIER_COLORS = {
    "Mythic": "#FF6B35",      # Orange-gold
    "Legendary": "#9B59B6",   # Purple
    "Epic": "#3498DB",        # Blue
    "Rare": "#2ECC71",        # Green
    "Common": "#95A5A6",      # Gray
}

# Formula definition (same as Phase 5)
FORMULA_CONFIG = {
    "version": "4.0",
    "name": "The Xeet Co-Efficient",
    "generatedAt": datetime.utcnow().isoformat() + "Z",
    "methodology": "Rank-based normalization (0-100) per signal, weighted composite across 4 dimensions",
    "creatorsScored": 391,
    "dimensions": [
        {
            "name": "performance",
            "label": "Performance",
            "weight": 0.42,
            "description": "Competitive tournament quality and consistency",
            "signals": [
                {"name": "avgDifficultyAdjustedPercentile", "label": "Avg Percentile", "weight": 0.35, "inverted": False},
                {"name": "totalXeetsExclXeetsgiving", "label": "Total XEETS", "weight": 0.25, "inverted": False},
                {"name": "competitiveTournamentCount", "label": "Competitive Tournaments", "weight": 0.25, "inverted": False},
                {"name": "signalRatioAvg", "label": "Signal Ratio", "weight": 0.15, "inverted": False},
            ],
        },
        {
            "name": "ecosystem",
            "label": "Ecosystem Alignment",
            "weight": 0.23,
            "description": "Ecosystem investment, cross-project alignment, skin-in-the-game",
            "signals": [
                {"name": "deckReachScore", "label": "Deck Reach", "weight": 0.35, "inverted": False},
                {"name": "ownCardsHeld", "label": "Own Cards Held", "weight": 0.30, "inverted": False},
                {"name": "multiplierBreadth", "label": "Multiplier Breadth", "weight": 0.20, "inverted": False},
                {"name": "cryptoCreatorXeets", "label": "Crypto Creator XEETS", "weight": 0.15, "inverted": False},
            ],
        },
        {
            "name": "reach",
            "label": "Reach / Efficiency",
            "weight": 0.20,
            "description": "Audience size, conversion efficiency, and niche breadth",
            "signals": [
                {"name": "followers", "label": "Followers", "weight": 0.35, "inverted": False},
                {"name": "xpf", "label": "XPF (XEETS/Followers)", "weight": 0.35, "inverted": False},
                {"name": "nicheDiversity", "label": "Niche Diversity", "weight": 0.30, "inverted": False},
            ],
        },
        {
            "name": "market",
            "label": "Market",
            "weight": 0.15,
            "description": "Market agreement indicator — does the market see it too?",
            "signals": [
                {"name": "osFloorCommon", "label": "OS Floor (Common)", "weight": 0.25, "inverted": False},
                {"name": "ethSaleVolume", "label": "ETH Sale Volume", "weight": 0.25, "inverted": False},
                {"name": "highestSaleCommon", "label": "Highest Sale (Common)", "weight": 0.20, "inverted": False},
                {"name": "priceTrajectory", "label": "Price Trajectory", "weight": 0.15, "inverted": False},
                {"name": "saleVelocity30d", "label": "30d Sale Velocity", "weight": 0.15, "inverted": False},
            ],
        },
    ],
    "tiers": [
        {"name": "Mythic", "minPercentile": 93.6, "color": TIER_COLORS["Mythic"]},
        {"name": "Legendary", "minPercentile": 80.8, "color": TIER_COLORS["Legendary"]},
        {"name": "Epic", "minPercentile": 61.6, "color": TIER_COLORS["Epic"]},
        {"name": "Rare", "minPercentile": 33.5, "color": TIER_COLORS["Rare"]},
        {"name": "Common", "minPercentile": 0, "color": TIER_COLORS["Common"]},
    ],
    "casualParticipationFilter": {
        "method": "ceil(medianXeets / 10) * 10",
        "description": "Tournament entries below this threshold are flagged as casual and excluded from performance metrics",
    },
    "excludedTournaments": {
        "xeetsgiving": "Excluded entirely — 3-day event, everyone wins, zero competitive signal",
        "cancelled": ["cryptoys", "adi", "datahaven"],
    },
}


def clean_value(v):
    """Convert numpy types to Python native for JSON serialization."""
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        if np.isnan(v):
            return None
        return round(float(v), 4)
    if isinstance(v, (np.bool_,)):
        return bool(v)
    return v


def main():
    print("=" * 70)
    print("PHASE 6: OUTPUT FILES")
    print("=" * 70)

    df = pd.read_parquet(OUTPUT_DIR / "scored_creators.parquet")
    print(f"Loaded {len(df)} scored creators\n")

    # --- 1. xcc-scores.json ---
    print("Generating xcc-scores.json...")
    scores = []
    for _, r in df.sort_values("rank").iterrows():
        entry = {
            "xHandle": r["xHandle"],
            "displayName": clean_value(r.get("displayName", r["xHandle"])),
            "tier": r["tier"],
            "tierColor": TIER_COLORS.get(r["tier"], "#95A5A6"),
            "rank": int(r["rank"]),
            "compositeScore": clean_value(r["compositeScore"]),
            "dimensions": {
                "performance": clean_value(r["dim_performance"]),
                "market": clean_value(r["dim_market"]),
                "ecosystem": clean_value(r["dim_ecosystem"]),
                "reach": clean_value(r["dim_reach"]),
            },
            "signals": {
                "totalXeetsExclXeetsgiving": clean_value(r["totalXeetsExclXeetsgiving"]),
                "competitiveTournamentCount": clean_value(r["competitiveTournamentCount"]),
                "avgDifficultyAdjustedPercentile": clean_value(r["avgDifficultyAdjustedPercentile"]),
                "signalRatioAvg": clean_value(r["signalRatioAvg"]),
                "multiplierBreadth": clean_value(r["multiplierBreadth"]),
                "cryptoCreatorRank": clean_value(r["cryptoCreatorRank"]),
                "cryptoCreatorXeets": clean_value(r["cryptoCreatorXeets"]),
                "osFloorCommon": clean_value(r["osFloorCommon"]),
                "osFloorRare": clean_value(r.get("osFloorRare")),
                "ethSaleVolume": clean_value(r["ethSaleVolume"]),
                "highestSaleCommon": clean_value(r["highestSaleCommon"]),
                "highestSaleRare": clean_value(r.get("highestSaleRare")),
                "priceTrajectory": clean_value(r["priceTrajectory"]),
                "rarityPremiumRatio": clean_value(r.get("rarityPremiumRatio")),
                "saleVelocity30d": clean_value(r["saleVelocity30d"]),
                "ownCardsHeld": clean_value(r["ownCardsHeld"]),
                "deckReachScore": clean_value(r["deckReachScore"]),
                "followers": clean_value(r["followers"]),
                "nicheDiversity": clean_value(r["nicheDiversity"]),
                "bestRank": clean_value(r["bestRank"]),
                "totalSupply": clean_value(r["totalSupply"]),
                "uniqueCollectors": clean_value(r["uniqueCollectors"]),
                "collectorDensity": clean_value(r["collectorDensity"]),
            },
        }
        scores.append(entry)

    scores_path = OUTPUT_DIR / "xcc-scores.json"
    with open(scores_path, "w") as f:
        # json.dump emits bare NaN literals (invalid JSON — breaks the frontend's
        # JSON.parse). Scrub the whole tree to null, whatever fields slipped past
        # clean_value.
        json.dump(_nan_to_null(scores), f, indent=2)
    print(f"  Saved {len(scores)} creators to {scores_path}")

    # --- 2. formula-config.json ---
    print("Generating formula-config.json...")
    config_path = OUTPUT_DIR / "formula-config.json"
    with open(config_path, "w") as f:
        json.dump(FORMULA_CONFIG, f, indent=2)
    print(f"  Saved to {config_path}")

    # --- 3. Summary stats ---
    print("\n" + "=" * 70)
    print("FINAL SUMMARY")
    print("=" * 70)

    tier_counts = df["tier"].value_counts()
    print(f"\nTier Distribution:")
    for tier in ["Mythic", "Legendary", "Epic", "Rare", "Common"]:
        count = tier_counts.get(tier, 0)
        tier_df = df[df["tier"] == tier]
        avg_score = tier_df["compositeScore"].mean()
        min_score = tier_df["compositeScore"].min()
        max_score = tier_df["compositeScore"].max()
        print(f"  {tier:<12s}: {count:>4d} creators | score range: {min_score:.1f} - {max_score:.1f} (avg {avg_score:.1f})")

    print(f"\nFiles generated:")
    print(f"  {scores_path}")
    print(f"  {config_path}")
    print(f"\nCopy to web/public/data/ for frontend consumption:")
    print(f"  cp {scores_path} {BASE_DIR / 'web/public/data/xcc-scores.json'}")
    print(f"  cp {config_path} {BASE_DIR / 'web/public/data/formula-config.json'}")


if __name__ == "__main__":
    main()
