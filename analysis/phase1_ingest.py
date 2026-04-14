"""Phase 1: Data Ingestion & Inventory — Build unified creator DataFrame."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from collections import Counter
from config import *
from loader import *


def process_tournaments(creator, difficulty_data):
    """Process a creator's tournament array into aggregated metrics."""
    tournaments = creator.get("tournaments", [])
    handle = creator["xHandle"]

    total_xeets_all = 0
    total_xeets_excl_xeetsgiving = 0
    cancelled_xeets = 0
    organic_xeets_competitive = 0  # signal + noise across competitive entries only
    competitive_entries = []
    casual_count = 0
    multiplier_tournaments = set()
    niches = set()
    crypto_creator_rank = None
    crypto_creator_xeets = None
    all_competitive_ranks = []
    all_percentiles = []

    for t in tournaments:
        slug = t["topicSlug"]
        resolved = resolve_slug(slug)
        points = t.get("totalPoints", 0) or 0
        rank = t.get("rank")
        signal_pts = t.get("signalPoints", 0) or 0
        noise_pts = t.get("noisePoints", 0) or 0
        bonus_pts = t.get("bonusPoints", 0) or 0
        mult = t.get("multiplier", 1.0) or 1.0

        total_xeets_all += points

        # Excluded tournaments: no competitive signal
        if resolved in EXCLUDED_PERFORMANCE_SLUGS:
            continue

        total_xeets_excl_xeetsgiving += points

        # Cancelled tournaments: count XEETS but exclude from performance
        if resolved in CANCELLED_SLUGS:
            cancelled_xeets += points
            continue

        # Get tournament stats
        real_participants, median_xeets, resolved_key = get_tournament_stats(
            slug, difficulty_data, t.get("rewardStartDate")
        )

        # Orphan tournaments: count XEETS, skip performance metrics
        if resolved in ORPHAN_SLUGS or real_participants is None:
            continue

        # Track niche
        niche = TOURNAMENT_NICHES.get(resolved, "Unknown")
        niches.add(niche)

        # Casual participation filter — two checks:
        # 1. XEETS-based: earned below median-rounded-up threshold
        # 2. Rank-based: finished beyond 3x the eligible winners cutoff
        threshold = casual_threshold(median_xeets)
        rank_thresh = rank_casual_threshold(resolved)
        manual_key = (handle.lower(), resolved)

        is_xeets_casual = points < threshold
        is_rank_casual = (rank_thresh is not None and rank is not None and rank > rank_thresh)
        is_manual_casual = manual_key in MANUAL_CASUAL_OVERRIDES

        if is_xeets_casual or is_rank_casual or is_manual_casual:
            casual_count += 1
            continue

        # This is a competitive entry
        # Organic XEETS = signal + noise (strips bonus from V1 multipliers)
        organic_xeets_competitive += signal_pts + noise_pts

        # Track multiplier breadth (only for non-platform tournaments)
        if mult > 1.0 and resolved not in PLATFORM_SLUGS:
            multiplier_tournaments.add(resolved)

        # Crypto Creator standalone signal
        if resolved == "ct":
            crypto_creator_rank = rank
            crypto_creator_xeets = points

        # Difficulty-adjusted percentile
        if real_participants and real_participants > 0 and rank is not None:
            pctile = 1.0 - (rank / real_participants)
            all_percentiles.append(pctile)
            all_competitive_ranks.append(rank)

        # Signal ratio (only for competitive entries)
        signal_ratio = signal_pts / points if points > 0 else 0

        competitive_entries.append({
            "slug": resolved_key,
            "rank": rank,
            "points": points,
            "signalRatio": signal_ratio,
            "percentile": pctile if (real_participants and rank) else None,
            "realParticipants": real_participants,
            "niche": niche,
        })

    return {
        "totalXeetsAllTime": total_xeets_all,
        "totalXeetsExclXeetsgiving": total_xeets_excl_xeetsgiving,
        "organicXeetsCompetitive": organic_xeets_competitive,
        "cancelledXeets": cancelled_xeets,
        "competitiveTournamentCount": len(competitive_entries),
        "casualEntryCount": casual_count,
        "avgDifficultyAdjustedPercentile": np.mean(all_percentiles) if all_percentiles else None,
        "medianDifficultyAdjustedPercentile": np.median(all_percentiles) if all_percentiles else None,
        "signalRatioAvg": np.mean([e["signalRatio"] for e in competitive_entries]) if competitive_entries else None,
        "cryptoCreatorRank": crypto_creator_rank,
        "cryptoCreatorXeets": crypto_creator_xeets,
        "multiplierBreadth": len(multiplier_tournaments),
        "nicheDiversity": len(niches),
        "bestRank": min(all_competitive_ranks) if all_competitive_ranks else None,
        "avgRankCompetitive": np.mean(all_competitive_ranks) if all_competitive_ranks else None,
        "competitiveEntries": competitive_entries,
    }


def build_market_signals(sales_df):
    """Aggregate sale_history into per-creator market signals."""
    # ETH-only sales (already normalized ETH+WETH -> ETH in loader)
    eth_sales = sales_df[sales_df["currency"] == "ETH"].copy()

    # Per creator aggregations
    creator_stats = {}
    for handle, group in eth_sales.groupby("creator_handle"):
        handle_lower = handle.lower() if handle else handle

        # Basic counts
        eth_count = len(group)
        eth_volume = group["price"].sum()
        unique_buyers = group["buyer"].nunique()
        last_sale_date = group["sold_at"].max()
        if pd.notna(last_sale_date):
            now = pd.Timestamp.now(tz=last_sale_date.tzinfo) if last_sale_date.tzinfo else pd.Timestamp.now()
            days_since = (now - last_sale_date).days
        else:
            days_since = None

        # Highest sale per rarity
        highest = {}
        for rarity in ["common", "rare", "legendary"]:
            r_sales = group[group["rarity"] == rarity]
            highest[rarity] = r_sales["price"].max() if len(r_sales) > 0 else None

        # Price trajectory: slope of last 10 OS sales over time
        os_sales = group[group["marketplace"] == "opensea"].sort_values("sold_at").tail(10)
        trajectory = None
        if len(os_sales) >= 3:
            x = (os_sales["sold_at"] - os_sales["sold_at"].min()).dt.total_seconds().values
            y = os_sales["price"].values
            if x[-1] > 0:  # avoid zero division
                # Simple linear regression slope
                x_norm = x / x[-1]  # normalize to 0-1
                slope = np.polyfit(x_norm, y, 1)[0]
                trajectory = slope

        # Sale velocity: OS sales in last 30 days
        sample_ts = group["sold_at"].iloc[0]
        tz = sample_ts.tzinfo if pd.notna(sample_ts) else None
        cutoff_30d = pd.Timestamp.now(tz=tz) - timedelta(days=30)
        velocity_30d = len(group[group["sold_at"] >= cutoff_30d])

        # Buyer concentration: unique buyers / total sales (high = distributed, low = whale)
        buyer_concentration = unique_buyers / eth_count if eth_count > 0 else None

        creator_stats[handle_lower] = {
            "ethSaleCount": eth_count,
            "ethSaleVolume": eth_volume,
            "uniqueBuyers": unique_buyers,
            "daysSinceLastSale": days_since,
            "highestSaleCommon": highest.get("common"),
            "highestSaleRare": highest.get("rare"),
            "highestSaleLegendary": highest.get("legendary"),
            "priceTrajectory": trajectory,
            "saleVelocity30d": velocity_30d,
            "buyerConcentration": buyer_concentration,
        }

    return creator_stats


def main():
    print("=" * 70)
    print("PHASE 1: DATA INGESTION & INVENTORY")
    print("=" * 70)

    # --- Load all data sources ---
    print("\n[1/7] Loading creators...")
    creators = load_creators_full()
    print(f"  Loaded {len(creators)} creators from xeet-creators-full.json")

    print("[2/7] Loading tournament difficulty data...")
    difficulty_data = load_tournament_difficulty()
    print(f"  Loaded {len(difficulty_data)} tournaments from difficulty JSON")

    print("[3/7] Loading floor prices...")
    floor_prices = load_floor_prices()
    print(f"  Loaded floor prices for {len(floor_prices)} creators")

    print("[4/7] Loading sale history from SQLite...")
    sales_df = query_sale_history()
    print(f"  Loaded {len(sales_df)} sales ({len(sales_df[sales_df['currency'] == 'ETH'])} ETH, {len(sales_df[sales_df['currency'] == 'XEETS'])} XEETS)")

    print("[5/7] Loading creator holdings...")
    holdings = load_creator_holdings()
    print(f"  Loaded holdings for {len(holdings)} creators")

    print("[6/7] Loading deck scores...")
    deck_scores = load_deck_scores()
    wallet_scores = deck_scores.get("wallets", {})
    print(f"  Loaded deck scores for {len(wallet_scores)} wallets")

    print("[7/7] Loading profiles + multi-wallet...")
    profiles = load_creator_profiles()
    multi_wallet = load_multi_wallet_creators()
    print(f"  Loaded {len(profiles)} profiles, {len(multi_wallet)} multi-wallet creators")

    # --- Build market signals from sales ---
    print("\nBuilding market signals from sale_history...")
    market_signals = build_market_signals(sales_df)
    print(f"  Computed market signals for {len(market_signals)} creators")

    # --- Build unified DataFrame ---
    print("\nBuilding unified creator DataFrame...")
    rows = []

    for c in creators:
        handle = c["xHandle"]
        handle_lower = handle.lower()
        wallet = c.get("walletAddress", "").lower()

        # --- Tournament metrics ---
        tm = process_tournaments(c, difficulty_data)

        # --- Card supply ---
        cards = c.get("cards", {})

        # --- Floor prices ---
        fp = floor_prices.get(handle_lower, floor_prices.get(handle, {}))

        def get_floor(rarity):
            r = fp.get(rarity, {})
            return {
                f"osFloor{rarity.capitalize()}": r.get("osFloor"),
                f"xeetFloor{rarity.capitalize()}": r.get("xeetFloor"),
                f"lastSalePrice{rarity.capitalize()}": r.get("lastSalePrice"),
                f"bestOffer{rarity.capitalize()}": r.get("bestOffer"),
                f"xeetListings{rarity.capitalize()}": r.get("xeetListings", 0),
                f"osListings{rarity.capitalize()}": r.get("osListings", 0),
            }

        floors = {}
        for rarity in ["common", "rare", "legendary"]:
            floors.update(get_floor(rarity))

        # Rarity premium ratio: rare floor / common floor
        os_rare = floors.get("osFloorRare")
        os_common = floors.get("osFloorCommon")
        rarity_premium = (os_rare / os_common) if (os_rare and os_common and os_common > 0) else None

        # --- Market signals from sales ---
        ms = market_signals.get(handle_lower, {})

        # --- Holdings / Activity ---
        # Own cards held (check multi-wallet)
        own_cards = 0
        creator_holding = holdings.get(handle_lower, holdings.get(handle, {}))
        if isinstance(creator_holding, dict):
            holds_list = creator_holding.get("holds", [])
            for h in holds_list:
                if h.get("creator", "").lower() == handle_lower:
                    own_cards += h.get("quantity", 0)

        # Multi-wallet: add cards from alt wallets
        if handle in multi_wallet or handle_lower in multi_wallet:
            mw = multi_wallet.get(handle, multi_wallet.get(handle_lower, {}))
            for alt in mw.get("additionalWallets", []):
                for h in alt.get("holdings", []):
                    if h.get("creator", "").lower() == handle_lower:
                        own_cards += h.get("quantity", 0)

        total_cards_held = 0
        if isinstance(creator_holding, dict):
            for h in creator_holding.get("holds", []):
                total_cards_held += h.get("quantity", 0)

        # Deck reach score (match by wallet)
        ds = wallet_scores.get(wallet, {})
        deck_reach = ds.get("score")
        deck_reach_rank = ds.get("rankAll")

        # Also check multi-wallet deck scores
        if deck_reach is None and (handle in multi_wallet or handle_lower in multi_wallet):
            mw = multi_wallet.get(handle, multi_wallet.get(handle_lower, {}))
            for alt in mw.get("additionalWallets", []):
                alt_wallet = alt.get("address", "").lower()
                alt_ds = wallet_scores.get(alt_wallet, {})
                if alt_ds.get("score") is not None:
                    if deck_reach is None or alt_ds["score"] > deck_reach:
                        deck_reach = alt_ds["score"]
                        deck_reach_rank = alt_ds.get("rankAll")

        # Profile data
        prof = profiles.get(handle, profiles.get(handle_lower, {}))
        xeet_balance = prof.get("xeetBalance")

        row = {
            # Identity
            "xHandle": handle,
            "displayName": c.get("displayName", handle),
            "walletAddress": c.get("walletAddress"),
            "followers": c.get("followers"),
            "ethosScore": c.get("ethosScore"),
            # Cards
            "totalSupply": cards.get("totalSupply", 0),
            "uniqueCollectors": cards.get("uniqueCollectors", 0),
            "collectorDensity": cards.get("collectorDensity", 0),
            "commonSupply": cards.get("commonSupply", 0),
            "rareSupply": cards.get("rareSupply", 0),
            "legendarySupply": cards.get("legendarySupply", 0),
            # Performance
            "totalXeetsAllTime": tm["totalXeetsAllTime"],
            "totalXeetsExclXeetsgiving": tm["totalXeetsExclXeetsgiving"],
            "organicXeetsCompetitive": tm["organicXeetsCompetitive"],
            "cancelledXeets": tm["cancelledXeets"],
            "competitiveTournamentCount": tm["competitiveTournamentCount"],
            "casualEntryCount": tm["casualEntryCount"],
            "avgDifficultyAdjustedPercentile": tm["avgDifficultyAdjustedPercentile"],
            "medianDifficultyAdjustedPercentile": tm["medianDifficultyAdjustedPercentile"],
            "signalRatioAvg": tm["signalRatioAvg"],
            "cryptoCreatorRank": tm["cryptoCreatorRank"],
            "cryptoCreatorXeets": tm["cryptoCreatorXeets"],
            "multiplierBreadth": tm["multiplierBreadth"],
            "nicheDiversity": tm["nicheDiversity"],
            "bestRank": tm["bestRank"],
            "avgRankCompetitive": tm["avgRankCompetitive"],
            # Market - floors
            **floors,
            "rarityPremiumRatio": rarity_premium,
            # Market - sales
            "ethSaleCount": ms.get("ethSaleCount", 0),
            "ethSaleVolume": ms.get("ethSaleVolume", 0),
            "uniqueBuyers": ms.get("uniqueBuyers", 0),
            "daysSinceLastSale": ms.get("daysSinceLastSale"),
            "highestSaleCommon": ms.get("highestSaleCommon"),
            "highestSaleRare": ms.get("highestSaleRare"),
            "highestSaleLegendary": ms.get("highestSaleLegendary"),
            "priceTrajectory": ms.get("priceTrajectory"),
            "saleVelocity30d": ms.get("saleVelocity30d", 0),
            "buyerConcentration": ms.get("buyerConcentration"),
            # Activity
            "ownCardsHeld": own_cards,
            "totalCardsHeld": total_cards_held,
            "deckReachScore": deck_reach,
            "deckReachRank": deck_reach_rank,
            "xeetBalance": xeet_balance,
        }
        rows.append(row)

    df = pd.DataFrame(rows)

    # --- STOP GATE: Report ---
    print("\n" + "=" * 70)
    print("PHASE 1 STOP GATE: DATA INVENTORY REPORT")
    print("=" * 70)

    print(f"\nTotal creators: {len(df)}")
    print(f"Columns: {len(df.columns)}")

    # Null counts
    print("\n--- Null Counts (top 20 most null columns) ---")
    nulls = df.isnull().sum().sort_values(ascending=False)
    for col, count in nulls.head(20).items():
        pct = count / len(df) * 100
        if count > 0:
            print(f"  {col:45s} {count:4d} ({pct:5.1f}%)")

    # Creators with 0 competitive entries
    zero_comp = df[df["competitiveTournamentCount"] == 0]
    print(f"\nCreators with 0 competitive tournament entries: {len(zero_comp)}")
    if len(zero_comp) <= 20:
        for _, r in zero_comp.iterrows():
            print(f"  {r['xHandle']:25s} totalXeets={r['totalXeetsAllTime']:>8.0f}")

    # Distribution of competitive tournament counts
    print("\n--- Competitive Tournament Count Distribution ---")
    print(df["competitiveTournamentCount"].describe().to_string())

    # Cross-reference validation
    print("\n--- Cross-Reference Validation ---")
    handles_set = set(df["xHandle"].str.lower())
    floor_handles = set(k.lower() for k in floor_prices.keys())
    holdings_handles = set(k.lower() for k in holdings.keys())
    profile_handles = set(k.lower() for k in profiles.keys())

    missing_floors = handles_set - floor_handles
    missing_holdings = handles_set - holdings_handles
    missing_profiles = handles_set - profile_handles
    print(f"  Creators missing from floor-prices: {len(missing_floors)}")
    print(f"  Creators missing from holdings:     {len(missing_holdings)}")
    print(f"  Creators missing from profiles:     {len(missing_profiles)}")

    # Gut-feel Mythic candidates check
    print("\n--- Gut-Feel Mythic Candidates ---")
    print(f"{'Handle':<20s} {'CompTourn':>9s} {'AvgPctile':>10s} {'TotalXeets':>11s} {'BestRank':>9s} {'CryptoCreator':>14s}")
    for candidate in MYTHIC_CANDIDATES:
        match = df[df["xHandle"].str.lower() == candidate.lower()]
        if len(match) == 0:
            print(f"  {candidate:<20s} NOT FOUND IN DATA")
            continue
        r = match.iloc[0]
        cc_rank = f"#{int(r['cryptoCreatorRank'])}" if pd.notna(r['cryptoCreatorRank']) else "N/A"
        avg_p = f"{r['avgDifficultyAdjustedPercentile']:.3f}" if pd.notna(r['avgDifficultyAdjustedPercentile']) else "N/A"
        best = f"#{int(r['bestRank'])}" if pd.notna(r['bestRank']) else "N/A"
        print(f"  {r['xHandle']:<20s} {r['competitiveTournamentCount']:>9.0f} {avg_p:>10s} {r['totalXeetsExclXeetsgiving']:>11.0f} {best:>9s} {cc_rank:>14s}")

    # Top 15 by total XEETS
    print("\n--- Top 15 by Total XEETS (excl Xeetsgiving) ---")
    top15 = df.nlargest(15, "totalXeetsExclXeetsgiving")
    print(f"{'Handle':<20s} {'XEETS':>10s} {'CompTourn':>10s} {'AvgPctile':>10s} {'SignalR':>8s}")
    for _, r in top15.iterrows():
        avg_p = f"{r['avgDifficultyAdjustedPercentile']:.3f}" if pd.notna(r['avgDifficultyAdjustedPercentile']) else "N/A"
        sr = f"{r['signalRatioAvg']:.3f}" if pd.notna(r['signalRatioAvg']) else "N/A"
        print(f"  {r['xHandle']:<20s} {r['totalXeetsExclXeetsgiving']:>10.0f} {r['competitiveTournamentCount']:>10.0f} {avg_p:>10s} {sr:>8s}")

    # Save
    output_path = OUTPUT_DIR / "unified_creators.parquet"
    df.to_parquet(output_path, index=False)
    print(f"\nSaved unified DataFrame to {output_path}")
    print(f"  Shape: {df.shape}")

    # Also save as CSV for easy inspection
    csv_path = OUTPUT_DIR / "unified_creators.csv"
    df.to_csv(csv_path, index=False)
    print(f"  Also saved CSV to {csv_path}")

    return df


if __name__ == "__main__":
    main()
