"""Paths, constants, and tournament slug mappings for XCC analysis."""
from pathlib import Path
import math

# Repo root — resolved from this file's location so the pipeline runs on any machine.
BASE_DIR = Path(__file__).resolve().parent.parent

# Data files
CREATORS_FULL = BASE_DIR / "xeet-creators-full.json"
CREATORS_ENRICHED = BASE_DIR / "xeet-creators-enriched.json"
TOURNAMENT_DIFFICULTY = BASE_DIR / "tournament-difficulty-data.json"
TOURNAMENT_CSV = BASE_DIR / "tournament-difficulty-table.csv"
FLOOR_PRICES = BASE_DIR / "web" / "public" / "data" / "floor-prices.json"
CREATOR_HOLDINGS = BASE_DIR / "creator-holdings.json"
CREATOR_PROFILES = BASE_DIR / "creators-profiles.json"
HOLDER_SNAPSHOT = BASE_DIR / "holder-snapshot.json"
DECK_SCORES = BASE_DIR / "deck-scores.json"
MULTI_WALLET = BASE_DIR / "multi-wallet-creators.json"
XEET_DB = BASE_DIR / "xeet.db"

# Output
OUTPUT_DIR = BASE_DIR / "analysis" / "output"

# Tournament slug mapping: creator data slug -> difficulty data slug
SLUG_MAP = {
    "crypto-creator": "ct",
    "xeet-infofi": "xeet",
}

# Tournaments excluded entirely from performance calculations
XEETSGIVING_SLUG = "xeetsgiving"
EXCLUDED_PERFORMANCE_SLUGS = {"xeetsgiving"}  # No competitive signal
# Abstract: NOT excluded, but uses PLATFORM_RANK_CUTOFF (top 500) via rank filter

# Cancelled tournaments: count XEETS but exclude from performance metrics
CANCELLED_SLUGS = {"cryptoys", "adi", "datahaven"}

# Orphan tournaments: no difficulty data available. Count XEETS, exclude from difficulty-adjusted metrics.
ORPHAN_SLUGS = {"grimmy", "vault777"}

# Platform tournaments (100% win rate): treat as activity signal, not performance
PLATFORM_SLUGS = {"xeet", "ct", "abstract"}

# IOPn drop date boundaries (from creator data date ranges)
# Drop 1: Oct 22 - Nov 27, Drop 2: Nov 27 - Dec 27, Drop 3: Dec 29 - Jan 15
IOPN_DROPS = {
    1: {"start": "2025-10-22", "end": "2025-11-27"},
    2: {"start": "2025-11-27", "end": "2025-12-27"},
    3: {"start": "2025-12-29", "end": "2026-01-15"},
}

# IOPn per-drop stats from CSV (since JSON has NULLs)
IOPN_DROP_STATS = {
    1: {"realParticipants": 4889, "medianXeets": 14, "totalXeets": 137539, "winRate": 2.0},
    2: {"realParticipants": 1229, "medianXeets": 3, "totalXeets": 12515, "winRate": 8.1},
    3: {"realParticipants": 680, "medianXeets": 5, "totalXeets": 11549, "winRate": 14.7},
}

# ADI stats from CSV (JSON has NULLs, tournament is cancelled anyway)
ADI_STATS = {"realParticipants": 1194, "medianXeets": 10}

# Xeet/xeet-infofi stats from CSV (JSON has NULLs)
XEET_INFOFI_STATS = {"realParticipants": 33669, "medianXeets": 10}

# Tournament niches (from difficulty data)
TOURNAMENT_NICHES = {
    "cockio": "Gaming", "blinko": "Gaming",
    "solstice": "DeFi", "myriad": "DeFi", "vdex": "DeFi",
    "xyber": "Infrastructure", "iopn": "Infrastructure", "mezo": "Infrastructure",
    "claynosaurz": "NFT/Art", "chimpers": "NFT/Art", "wow": "NFT/Art", "gvc": "NFT/Art",
    "artery": "NFT/Art",
    "kona": "Social", "valannia": "Social", "fight": "Social",
    "lute": "Gaming", "thrust": "Gaming", "megaweapon": "Gaming",
    "desci-news": "Science", "project-zero": "Infrastructure",
    "litvm": "Infrastructure", "santa-browser": "Infrastructure",
    "onsight": "Infrastructure", "gamblr": "Gaming", "cipher": "Infrastructure",
    "ct": "Platform", "xeet": "Platform", "abstract": "Platform",
    "xeetsgiving": "Platform",
    "cryptoys": "Gaming", "adi": "Infrastructure", "datahaven": "Infrastructure",
    "grimmy": "Unknown", "vault777": "Unknown",
}

# Gut-feel Mythic candidates (sanity check)
MYTHIC_CANDIDATES = [
    "ProofOfEly", "chesus", "beijingdou", "waleswoosh", "lizmoneyweb",
    "icobeast", "walsxbt", "Tuteth_", "CryptoVonDoom", "lokithebird", "R2D2zen",
]

# ETH/USD rate from floor-prices.json (for reference, not for mixing currencies)
# Manual overrides: force specific tournament entries to casual for known cases
# Format: {(handle_lower, tournament_slug): "reason"}
MANUAL_CASUAL_OVERRIDES = {
    ("senti__23", "megaweapon"): "Only 2 posts, not competitive despite above-threshold XEETS",
}

# Rank-based casual filter: if rank > eligible_winners * RANK_CASUAL_MULTIPLIER, entry is casual
# For "Everyone" eligible tournaments (platform), use fixed cutoff
RANK_CASUAL_MULTIPLIER = 3
PLATFORM_RANK_CUTOFF = 500  # Top 500 in platform tournaments = competitive

# Eligible winners per tournament (parsed from difficulty data)
ELIGIBLE_WINNERS = {
    "cockio": 10, "blinko": 50, "chimpers": 20, "cipher": 100,
    "claynosaurz": 50, "desci-news": 25, "fight": 100, "gamblr": 100,
    "gvc": 25, "kona": 100, "litvm": 100, "lute": 500,
    "megaweapon": 100, "mezo": 100, "myriad": 500, "onsight": 100,
    "project-zero": 100, "santa-browser": 75, "solstice": 100,
    "thrust": 150, "valannia": 100, "vdex": 150, "wow": 50,
    "xyber": 100, "artery": 100, "iopn": 100,
    # Platform tournaments
    "ct": None, "xeet": None,       # No rank filter — every entry is meaningful
    "abstract": None,               # Uses PLATFORM_RANK_CUTOFF (top 500)
    # Cancelled
    "adi": 100, "cryptoys": None, "datahaven": None,
}


# Tournaments exempt from rank-based filter (every entry is meaningful)
RANK_FILTER_EXEMPT = {"ct", "xeet"}


def rank_casual_threshold(resolved_slug):
    """Return the rank threshold for casual filter. Rank above this = casual.
    Returns None for exempt tournaments (no rank filter applied)."""
    if resolved_slug in RANK_FILTER_EXEMPT:
        return None  # No rank filter
    elig = ELIGIBLE_WINNERS.get(resolved_slug)
    if elig is None:
        return PLATFORM_RANK_CUTOFF
    return elig * RANK_CASUAL_MULTIPLIER


ETH_USD_RATE = 2224.61


def casual_threshold(median_xeets):
    """Compute casual participation threshold: ceil(median / 10) * 10.
    E.g., median 12 -> 20, median 3 -> 10, median 19 -> 20."""
    if median_xeets is None or median_xeets <= 0:
        return 10  # conservative default
    return int(math.ceil(median_xeets / 10.0) * 10)


def resolve_slug(creator_slug):
    """Map creator-data tournament slug to difficulty-data slug."""
    return SLUG_MAP.get(creator_slug, creator_slug)


def identify_iopn_drop(reward_start_date):
    """Identify which IOPn drop a creator entry belongs to based on start date."""
    if not reward_start_date:
        return None
    date_str = reward_start_date[:10]  # "2025-10-22"
    for drop_num, dates in IOPN_DROPS.items():
        if dates["start"] <= date_str <= dates["end"]:
            return drop_num
    return None
