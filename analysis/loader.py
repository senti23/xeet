"""Shared data loading functions for XCC analysis."""
import json
import sqlite3
import pandas as pd
from pathlib import Path
from config import *


def load_json(path: Path):
    with open(path) as f:
        return json.load(f)


def load_creators_full() -> list:
    return load_json(CREATORS_FULL)


def load_tournament_difficulty() -> dict:
    """Load tournament difficulty data, keyed by slug."""
    raw = load_json(TOURNAMENT_DIFFICULTY)
    return {t["slug"]: t for t in raw["tournaments"]}


def load_tournament_csv() -> pd.DataFrame:
    """Load CSV with per-drop IOPn data and other stats."""
    df = pd.read_csv(TOURNAMENT_CSV)
    return df


def load_floor_prices() -> dict:
    """Load floor prices, keyed by creator handle."""
    raw = load_json(FLOOR_PRICES)
    return raw.get("prices", raw)


def load_creator_holdings() -> dict:
    return load_json(CREATOR_HOLDINGS)


def load_creator_profiles() -> dict:
    return load_json(CREATOR_PROFILES)


def load_holder_snapshot() -> dict:
    return load_json(HOLDER_SNAPSHOT)


def load_deck_scores() -> dict:
    return load_json(DECK_SCORES)


def load_multi_wallet_creators() -> dict:
    return load_json(MULTI_WALLET)


def query_sale_history() -> pd.DataFrame:
    """Load sale_history from SQLite. Normalize ETH/WETH to 'ETH'."""
    conn = sqlite3.connect(str(XEET_DB))
    df = pd.read_sql_query("SELECT * FROM sale_history", conn)
    conn.close()
    # Normalize currency
    df["currency"] = df["currency"].replace({"WETH": "ETH"})
    df["sold_at"] = pd.to_datetime(df["sold_at"])
    return df


def query_token_map() -> pd.DataFrame:
    conn = sqlite3.connect(str(XEET_DB))
    df = pd.read_sql_query("SELECT * FROM token_map", conn)
    conn.close()
    return df


def get_tournament_stats(slug, difficulty_data, reward_start_date=None):
    """Get realParticipants and medianXeets for a tournament slug.
    Handles IOPn drops, ADI, and xeet-infofi special cases."""
    resolved = resolve_slug(slug)

    # IOPn: identify drop and use per-drop stats
    if resolved == "iopn" or slug == "iopn":
        drop_num = identify_iopn_drop(reward_start_date)
        if drop_num and drop_num in IOPN_DROP_STATS:
            stats = IOPN_DROP_STATS[drop_num]
            return stats["realParticipants"], stats["medianXeets"], f"iopn-drop{drop_num}"
        # Fallback: use drop 1 stats (largest)
        stats = IOPN_DROP_STATS[1]
        return stats["realParticipants"], stats["medianXeets"], "iopn-drop?"

    # ADI: use CSV stats
    if resolved == "adi":
        return ADI_STATS["realParticipants"], ADI_STATS["medianXeets"], "adi"

    # Xeet-infofi/xeet: platform tournament
    if resolved == "xeet":
        return XEET_INFOFI_STATS["realParticipants"], XEET_INFOFI_STATS["medianXeets"], "xeet"

    # Orphan tournaments
    if resolved in ORPHAN_SLUGS:
        return None, None, resolved

    # Look up in difficulty data
    if resolved in difficulty_data:
        t = difficulty_data[resolved]
        rp = t.get("realParticipants")
        dist = t.get("distribution", {})
        median = dist.get("medianXeets")
        return rp, median, resolved

    return None, None, resolved
