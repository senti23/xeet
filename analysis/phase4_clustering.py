"""Phase 4: Clustering — Find natural creator tiers via unsupervised methods."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans, AgglomerativeClustering
from sklearn.metrics import silhouette_score
from scipy.cluster.hierarchy import dendrogram, linkage, fcluster
from scipy.stats import rankdata
from config import *


# Clustering features — selected from Phase 3 findings
# Using signals with high CV and low inter-correlation
CLUSTER_FEATURES = [
    # Performance
    "totalXeetsExclXeetsgiving",
    "competitiveTournamentCount",
    "signalRatioAvg",
    "multiplierBreadth",
    # Market
    "osFloorCommon",
    "ethSaleVolume",
    "highestSaleCommon",
    # Activity
    "ownCardsHeld",
    "deckReachScore",
    # Reach
    "followers",
    "cryptoCreatorXeets",
]


def prepare_features(df):
    """Prepare feature matrix: impute nulls, rank-transform skewed signals, standardize."""
    feat_df = df[CLUSTER_FEATURES].copy()

    # Impute nulls with column median
    for col in feat_df.columns:
        median_val = feat_df[col].median()
        feat_df[col] = feat_df[col].fillna(median_val)

    # Rank-transform heavily skewed signals (most of ours are right-skewed)
    # This reduces outlier influence and makes distances more meaningful
    skewed_cols = [
        "totalXeetsExclXeetsgiving", "ethSaleVolume", "highestSaleCommon",
        "followers", "cryptoCreatorXeets", "osFloorCommon",
    ]
    for col in skewed_cols:
        if col in feat_df.columns:
            feat_df[col] = rankdata(feat_df[col], method="average")

    # Standardize
    scaler = StandardScaler()
    X = scaler.fit_transform(feat_df)

    return X, feat_df, scaler


def main():
    print("=" * 70)
    print("PHASE 4: CLUSTERING")
    print("=" * 70)

    df = pd.read_parquet(OUTPUT_DIR / "unified_creators.parquet")
    print(f"Loaded {len(df)} creators\n")

    X, feat_df, scaler = prepare_features(df)
    print(f"Feature matrix: {X.shape}")
    print(f"Features used: {CLUSTER_FEATURES}\n")

    # --- K-Means for k = 3,4,5,6,7 ---
    print("=" * 70)
    print("K-MEANS CLUSTERING (k=3 to 7)")
    print("=" * 70)

    results = {}
    for k in range(3, 8):
        km = KMeans(n_clusters=k, random_state=42, n_init=20)
        labels = km.fit_predict(X)
        sil = silhouette_score(X, labels)
        sizes = pd.Series(labels).value_counts().sort_index()
        results[k] = {"labels": labels, "silhouette": sil, "sizes": sizes, "model": km}
        size_str = ", ".join(f"C{i}={s}" for i, s in sizes.items())
        print(f"  k={k}: silhouette={sil:.4f}  sizes: [{size_str}]")

    # Find best k
    best_k = max(results, key=lambda k: results[k]["silhouette"])
    print(f"\n  Best k by silhouette: {best_k} (score={results[best_k]['silhouette']:.4f})")

    # --- Hierarchical Clustering (Ward's) ---
    print("\n" + "=" * 70)
    print("HIERARCHICAL CLUSTERING (Ward's linkage)")
    print("=" * 70)

    Z = linkage(X, method="ward")
    for k in range(3, 8):
        labels_h = fcluster(Z, t=k, criterion="maxclust") - 1  # 0-indexed
        sil_h = silhouette_score(X, labels_h)
        sizes_h = pd.Series(labels_h).value_counts().sort_index()
        size_str = ", ".join(f"C{i}={s}" for i, s in sizes_h.items())
        print(f"  k={k}: silhouette={sil_h:.4f}  sizes: [{size_str}]")

    # --- Use best_k for detailed profiling ---
    # Also check k=5 (matches Xeet rarity tiers: Mythic/Legendary/Epic/Rare/Common)
    profile_k = best_k
    # If k=5 is close to best, prefer it for alignment with game tiers
    if abs(results[5]["silhouette"] - results[best_k]["silhouette"]) < 0.02:
        profile_k = 5
        print(f"\n  Using k=5 (close to best, aligns with Xeet rarity tiers)")
    else:
        print(f"\n  Using k={profile_k} (best silhouette)")

    labels = results[profile_k]["labels"]
    df["cluster"] = labels

    # --- Profile Each Cluster ---
    print("\n" + "=" * 70)
    print(f"CLUSTER PROFILES (k={profile_k})")
    print("=" * 70)

    profile_cols = [
        "totalXeetsExclXeetsgiving", "competitiveTournamentCount",
        "avgDifficultyAdjustedPercentile", "signalRatioAvg",
        "cryptoCreatorXeets", "multiplierBreadth",
        "osFloorCommon", "ethSaleVolume", "highestSaleCommon",
        "priceTrajectory", "saleVelocity30d",
        "ownCardsHeld", "deckReachScore", "followers",
    ]

    # Compute composite z-score for ranking within clusters
    for col in profile_cols:
        clean = df[col].dropna()
        df[f"z_{col}"] = (df[col] - clean.mean()) / clean.std()

    # Composite z-score (performance-weighted)
    perf_z_cols = ["z_totalXeetsExclXeetsgiving", "z_competitiveTournamentCount",
                   "z_avgDifficultyAdjustedPercentile", "z_signalRatioAvg"]
    available_z = [c for c in perf_z_cols if c in df.columns]
    df["composite_z"] = df[available_z].mean(axis=1)

    # Sort clusters by mean composite_z (highest = best tier)
    cluster_means = df.groupby("cluster")["composite_z"].mean().sort_values(ascending=False)
    tier_map = {}
    tier_names = ["Mythic", "Legendary", "Epic", "Rare", "Common", "Inactive", "Dead"]
    for rank_idx, cluster_id in enumerate(cluster_means.index):
        if rank_idx < len(tier_names):
            tier_map[cluster_id] = tier_names[rank_idx]

    df["tier"] = df["cluster"].map(tier_map)

    for tier_name in tier_names[:profile_k]:
        cluster_df = df[df["tier"] == tier_name]
        if len(cluster_df) == 0:
            continue

        print(f"\n{'='*60}")
        print(f"  TIER: {tier_name.upper()} ({len(cluster_df)} creators)")
        print(f"{'='*60}")

        # Summary stats
        print(f"\n  {'Signal':<35s} {'Mean':>10s} {'Median':>10s}")
        print(f"  {'-'*55}")
        for col in profile_cols:
            mean = cluster_df[col].mean()
            median = cluster_df[col].median()
            def fmt(v):
                if pd.isna(v): return "N/A"
                if abs(v) >= 100: return f"{v:>10,.0f}"
                elif abs(v) >= 1: return f"{v:>10.2f}"
                else: return f"{v:>10.4f}"
            print(f"  {col:<35s} {fmt(mean)} {fmt(median)}")

        # Top 10 members by composite z-score
        top = cluster_df.nlargest(min(10, len(cluster_df)), "composite_z")
        print(f"\n  Top members:")
        print(f"  {'Handle':<22s} {'XEETS':>8s} {'CompT':>6s} {'AvgPctile':>10s} {'OSFloor':>10s} {'Followers':>10s}")
        for _, r in top.iterrows():
            pctile = f"{r['avgDifficultyAdjustedPercentile']:.3f}" if pd.notna(r['avgDifficultyAdjustedPercentile']) else "N/A"
            floor = f"{r['osFloorCommon']:.4f}" if pd.notna(r['osFloorCommon']) else "N/A"
            print(f"  {r['xHandle']:<22s} {r['totalXeetsExclXeetsgiving']:>8.0f} {r['competitiveTournamentCount']:>6.0f} {pctile:>10s} {floor:>10s} {r['followers']:>10,.0f}" if pd.notna(r['followers']) else f"  {r['xHandle']:<22s} {r['totalXeetsExclXeetsgiving']:>8.0f} {r['competitiveTournamentCount']:>6.0f} {pctile:>10s} {floor:>10s} {'N/A':>10s}")

    # --- Gut-Feel Mythic Mapping ---
    print("\n" + "=" * 70)
    print("GUT-FEEL MYTHIC CANDIDATE → TIER MAPPING")
    print("=" * 70)

    mythic_handles = [h.lower() for h in MYTHIC_CANDIDATES]
    for candidate in MYTHIC_CANDIDATES:
        match = df[df["xHandle"].str.lower() == candidate.lower()]
        if len(match) == 0:
            print(f"  {candidate:<20s} NOT FOUND")
            continue
        r = match.iloc[0]
        print(f"  {r['xHandle']:<20s} → {r['tier']:<12s} (cluster {r['cluster']}, z={r['composite_z']:.2f})")

    mythic_in_top = df[df["xHandle"].str.lower().isin(mythic_handles)]
    tiers_found = mythic_in_top["tier"].value_counts()
    print(f"\n  Distribution of gut-feel Mythics across tiers: {dict(tiers_found)}")

    # --- B-Tier Identification (undervalued) ---
    print("\n" + "=" * 70)
    print("B-TIER ALPHA: Strong performance, cheap market price")
    print("=" * 70)
    print("Creators in performance-strong tiers but with below-median OS floor\n")

    # Load market-performance gap
    try:
        gap_df = pd.read_csv(OUTPUT_DIR / "market_performance_gap.csv")
        df = df.merge(gap_df, on="xHandle", how="left")
    except:
        pass

    # Creators in top 2 performance tiers but with below-median OS floor
    top_tiers = tier_names[:2]  # Mythic + Legendary
    top_tier_df = df[df["tier"].isin(top_tiers)]
    median_floor = df["osFloorCommon"].median()

    undervalued = top_tier_df[top_tier_df["osFloorCommon"] <= median_floor]
    if len(undervalued) > 0:
        undervalued_sorted = undervalued.sort_values("composite_z", ascending=False)
        print(f"Median OS floor (common): {median_floor:.4f} ETH")
        print(f"Found {len(undervalued)} creators in {top_tiers} with floor <= median\n")
        print(f"{'Handle':<22s} {'Tier':<12s} {'XEETS':>8s} {'OSFloor':>10s} {'CompZ':>6s}")
        print("-" * 60)
        for _, r in undervalued_sorted.head(25).iterrows():
            floor = f"{r['osFloorCommon']:.4f}" if pd.notna(r['osFloorCommon']) else "N/A"
            print(f"  {r['xHandle']:<22s} {r['tier']:<12s} {r['totalXeetsExclXeetsgiving']:>8.0f} {floor:>10s} {r['composite_z']:>6.2f}")
    else:
        print("No undervalued creators found in top tiers (all have above-median floors)")

    # Also show "Next Tier Up" candidates: top of 3rd tier who are close to tier 2
    third_tier = tier_names[2] if profile_k >= 3 else None
    if third_tier:
        tier3 = df[df["tier"] == third_tier].nlargest(15, "composite_z")
        print(f"\n--- Borderline {third_tier} (top 15, closest to promotion) ---")
        print(f"{'Handle':<22s} {'XEETS':>8s} {'CompT':>6s} {'OSFloor':>10s} {'CompZ':>6s}")
        for _, r in tier3.iterrows():
            floor = f"{r['osFloorCommon']:.4f}" if pd.notna(r['osFloorCommon']) else "N/A"
            print(f"  {r['xHandle']:<22s} {r['totalXeetsExclXeetsgiving']:>8.0f} {r['competitiveTournamentCount']:>6.0f} {floor:>10s} {r['composite_z']:>6.2f}")

    # --- Tier Distribution Summary ---
    print("\n" + "=" * 70)
    print("TIER DISTRIBUTION SUMMARY")
    print("=" * 70)
    tier_counts = df["tier"].value_counts()
    for tier in tier_names[:profile_k]:
        count = tier_counts.get(tier, 0)
        avg_floor = df[df["tier"] == tier]["osFloorCommon"].mean()
        avg_xeets = df[df["tier"] == tier]["totalXeetsExclXeetsgiving"].mean()
        floor_str = f"{avg_floor:.4f}" if pd.notna(avg_floor) else "N/A"
        print(f"  {tier:<12s}: {count:>4d} creators | avg floor={floor_str} ETH | avg XEETS={avg_xeets:>8,.0f}")

    # Save clustered data
    save_cols = ["xHandle", "displayName", "tier", "cluster", "composite_z"] + profile_cols
    df[save_cols].to_csv(OUTPUT_DIR / "clustered_creators.csv", index=False)
    df.to_parquet(OUTPUT_DIR / "unified_creators_clustered.parquet", index=False)
    print(f"\nSaved to {OUTPUT_DIR / 'clustered_creators.csv'}")


if __name__ == "__main__":
    main()
