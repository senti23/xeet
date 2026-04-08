# XEET PROJECT BIBLE v3
## Last updated: 2026-03-31

> **Purpose**: Single source of truth for any agent or conversation working on Xeet market intelligence. Read this before asking questions or writing code.

---

## 1. WHAT IS XEET

### 1.1 Platform Overview

Xeet is a **results-based marketing platform** built on the **Abstract blockchain** (chain ID 2741). It connects brands with creators through a tournament system where verified outcomes (not engagement) earn rewards.

Xeet evolved from the InfoFi/SocialFi era. The founder's thesis: "Paying for engagement is not paying for outcomes." The platform keeps the distribution mechanics of InfoFi, the identity/access layer of SocialFi, and the outcome alignment of affiliate marketing — but structures incentives so the only way to win is to drive verified results through coordinated teams.

### 1.2 Core Concepts

**Creator Cards (ERC-1155 NFTs)**
- Contract: `0xeC27D2237432D06981e1F18581494661517E1bD3` on Abstract (chain 2741)
- Every Xeet Certified Creator (XCC) has cards in up to 5 rarity tiers: Common, Rare, Legendary, Epic, Mythic
- Currently only Common, Rare, and Legendary exist in circulation
- Epic and Mythic confirmed to exist — acquisition method unknown
- Cards trade on two marketplaces: **Xeet Marketplace** (priced in XEETS) and **OpenSea** (priced in ETH/WETH)
- OpenSea collection slug: `xeet-creator-cards`

**Squads & Tournaments (V2 — not yet live)**
- Brands define tournaments with specific KPIs (signups, deposits, volume traded, referrals, etc.)
- Card ownership = access ticket to join a creator's squad for a tournament
- **One squad per tournament** — you commit to one squad leader, no hedging
- Rewards based on **verified results**, not posts or engagement
- Tournaments typically run ~1 month (based on V1 data)
- Multiple tournaments likely run concurrently (10+ possible)

**Squad Nesting ("Squad Inception")**
- Creator B can join Creator A's squad as a sub-leader
- Creator B's card holders are part of Creator A's squad tree
- This is organizational hierarchy (like departments in an agency), not independent squads merging
- Nesting depth cap: UNKNOWN

**XEETS Token**
- Contribution tracking unit within the platform
- Earned through tournament participation and verified results
- Used as pricing currency on Xeet Marketplace
- 2% burn rate on every XEETS-denominated sale on Xeet MP
- `xeetEarned` on leaderboard API = current live wallet balance (NOT historical earnings)
- `totalPoints` in user tournament endpoint = actual XEETS earned per tournament

### 1.3 Card Supply & Distribution

**Pack Sales (completed, first batch)**
- 10,000 Common packs, 3,500 Rare packs, 1,000 Legendary packs
- Some packs remain unopened
- Primary mechanism for cards entering circulation so far

**Supply Caps**
- Team-stated max supply per creator: **250 cards** (all rarities combined)
- Current circulating supply: ~1/3 of maximum (~80-100 per creator avg)
- Total cards in circulation: ~31,699 across 391 creators
- ~3,875 unique holder wallets
- New creators can join in the future

### 1.4 XCC (Xeet Certified Creator)

- 391 creators in the dataset with cards
- ~50K active XEETS earners across the platform
- XCC process gates leaderboards to real creators only
- Launched December 2025

### 1.5 Ecosystem Stats (as of March 2026)

| Metric | Value |
|--------|-------|
| Total creators with cards | 391 |
| Total cards in circulation | ~31,699 |
| Unique holder wallets | ~3,875 |
| Active XEETS earners | ~50,000 |
| Xeet MP total sales | ~2,975 |
| OpenSea total sales | ~12,214 |
| OpenSea total volume | ~30.6 ETH |
| Average cards per XCC wallet | 28.1 |
| Median cards per XCC wallet | 16 |

---

## 2. V2 GAME THEORY — OUR WORKING MODEL

### 2.1 The Agency Model (Confirmed)

The squad system mirrors a **marketing agency structure**:

| Role | Squad equivalent | How they earn |
|------|-----------------|---------------|
| Agency CEO | Squad leader | Wins the brand tournament, sets strategy, gets leader cut |
| Department heads | Sub-leaders (XCCs) | Recruited by leader to manage functions (content, community, onboarding) |
| Staff | Active holders (non-XCC) | Execute KPIs under a sub-leader's direction |
| Silent partners | Passive holders | Hold cards, take small revenue share |

Key insight: Creator B doesn't "join" Creator A's squad from outside — Creator B gets **hired** as a sub-leader within Creator A's operation. The card is agency equity.

### 2.2 One Card Per Tournament (Working Theory)

**Core rule:** One card = one tournament entry. If a creator is active in 3 concurrent tournaments and you want exposure to all 3, you need 3 of their cards.

This creates real demand pressure on card supply. With 10 concurrent tournaments, a popular creator's 80-100 cards get consumed fast. This justifies the 250 max supply cap AND future pack drops.

Burns/crafting become resource management: burn 3 commons for 1 rare (higher multiplier, 1 tournament) or keep 3 commons (lower multiplier, 3 tournaments).

### 2.3 Cross-Squad Yield — Ruled Out

Earning from Squad B while in Squad A = hedging, contradicts founder's article. Multi-card value only works WITHIN the same squad tree.

### 2.4 Secondary Reach via Sub-Squads

Non-XCC holders CAN enter squads through sub-leaders without holding the main leader's card. Hold Creator B's card → Creator B joins Creator A's squad as sub-leader → you enter through Creator B. This is "secondary reach" — the core concept behind the Deck Reach Score app.

### 2.5 Tournament Economics Model

Per tournament ($50K pool, 1 winner): leader ~$7,500 (15%), XCC subs ~$5,800 shared (35%), active holders ~$667 each (40%), passive holders ~$62 each (10%).

### 2.6 Creator Activation Math

~25% creator activation rate is healthy by TCG standards. With 8 concurrent tournaments, simulation showed 134/391 XCCs active (34%), 2,512/3,875 wallets engaged (65%), 38% of card supply locked.

---

## 3. DATA INVENTORY

### 3.1 Primary Dataset: xeet-creators-full.json

**391 creator objects** — canonical dataset for all XCCs.

Key fields: xHandle, displayName, walletAddress, followers, bio, ethosScore, totalXeetEarned, cards (commonSupply, rareSupply, legendarySupply, uniqueCollectors, collectorDensity), tournaments[] (per-tournament totalPoints, signalPoints, noisePoints, bonusPoints, rank, multiplier), derived (tournamentCount, totalXeetsAllTime, bestRank, avgRank).

**XEETS field distinction — CRITICAL:**
- `totalXeetEarned` = snapshot from header API at pull time. STALE.
- `derived.totalXeetsAllTime` = sum of tournament totalPoints = true lifetime earnings. RELIABLE.
- `xeetEarned` on leaderboard API = current live wallet balance, NOT historical.
- Per-tournament historical XEETS earned = `totalPoints` in `/api/user/handle/{username}/tournaments`.

**Data field: `cards.totalIssued`** = number of rarity tiers issued (not card editions). e.g., totalIssued=3 means common/rare/legendary all exist.

### 3.2 Creator Profiles: creators-profiles.json

392 creators keyed by X handle. Fields: `avatar` (Twitter pfp URL at pbs.twimg.com), `xeetBalance` (current live balance). Separate from xeet-creators-full.json; can be merged for enrichment.

### 3.3 Holder Data

- `holder-snapshot.json` — all wallet holdings from on-chain ERC-1155 transfers. 3,875 wallets, 31,699 total cards.
- `creator-holdings.json` — XCC cross-holdings. 386 XCCs with their card collections.
- `multi-wallet-creators.json` — 8 creators with alt wallets (Carlitoswa_y, KierianV, Meta_ZET, beijingdou, DjaniWhaleSkul, FogoNPC, BetmanJoe, monitalan).

### 3.4 Sales Data (in SQLite: xeet.db)

- `sale_history` table: 2,975 Xeet MP sales + 12,214 OpenSea sales, all 391 creators covered
- Fields: marketplace, token_id, creator_handle, rarity, price, currency, seller, buyer, order_hash, tx_hash, sold_at
- Xeet MP sales confirmed correct vs on-chain OrderExecuted logs
- OpenSea sales confirmed correct vs on-chain Seaport TransferSingle count
- mvc-web undercounts OS sales by ~1,000 (counts per transaction vs per card transfer)

### 3.5 APIs

**Xeet (no auth):** `/api/marketplace/discovery/items` (live listings), `/api/marketplace/discovery/activity` (trade history), `/api/user/handle/{h}/header` (profile), `/api/user/handle/{h}/tournaments` (per-tournament performance), `/api/tournaments/{slug}/leaderboard?limit=200&page=N` (full participant list)

**Xeet (auth required):** `/api/user/{id}/cards` (session cookie), `/api/user/{id}/packs`

**OpenSea (API key — confirmed working):** Collection stats, listings, events, offers, stream API. Key: `ddcaac6b9c624a58be000387dd275a17`. Rate limit: 4 req/s standard tier.

**Abscan:** `api.etherscan.io/v2/api?chainid=2741`, max 1,000 results per page, block-range pagination. `TransferSingle` topic0: `0xc3d58168c5ae7397731d063d5bbf3d657854427341981160ab18b56ad4b4f0b0`

**Xeet marketplace contract:** `0x4424844a9A96C143345C2470905403a4009AF237`, emits `OrderExecuted` with xeetPrice on-chain.

### 3.6 On-Chain Verified Facts

- Creator mints use contract `0x92aeb3bb...a27c` (method `0x7e56eba1`)
- Pack openings use contract `0x5a4a369f...8c0e` (method `0x3d30bc0e`)
- Clean separation by `to` address
- 389/391 creator wallets verified via rare card first-mint tracing
- bearish_af and tolibear_ resolved to same team wallet: `0x0c0898e12b6a317660474de8fff1e0069e2b3ad6`

---

## 4. OPEN QUESTIONS

### Critical (block progress)

| Question | Status |
|----------|--------|
| One card per tournament or covers all? | Working theory: one per tournament. Needs official confirmation. |
| How do rewards flow through sub-squads? | Wait for V2 launch |
| Nesting depth cap? | Unknown |
| V2 rarity multipliers? | Unknown |
| Epic/Mythic acquisition? | Confirmed to exist, method unknown |

### Estimable (can model)

| Question | Approach |
|----------|----------|
| Optimal deck composition? | Model by tournament type, use bridge/reach analysis |
| Which creators are underpriced? | Co-efficient score from performance + card metrics + floor price |
| Supply pressure per creator? | Model tournament count × card-per-tournament lock theory |

---

## 5. SENTI'S DECK ANALYSIS (March 2026)

| Metric | Value |
|--------|-------|
| Direct holdings | 111 creators (142 total cards) |
| Secondary reach | 275 creators |
| Total reach | 386 / 391 (98.7%) |
| Missing | 5-6 creators |
| Rarity breakdown | 3 legendary, 30 rare, 79 common-only |
| Overall rank | ~#32 |
| XCC rank | ~#18 |

**Missing creators:** celticmatheus, fud_berry, mide_ox, nashahmed3, nick_researcher (+ voxelqueen depending on data freshness)

**Top bridge cards (most secondary reach):** Djani (143), duckmaster.eth (115), Raiden (76), Moonraker (76), tdk (71)

**Activity concern:** 87/111 held creators have <40 cards in their wallet. 40 have ≤10 (barely collecting). These are potential dead weight under V2 squad model.

---

## 6. CONVENTIONS & PATTERNS

### Data handling
- Handle lookup: `'target' in c['xHandle'].lower()`
- Always normalize handles to lowercase before cross-referencing
- Use `copy.deepcopy()` before modifying fields in simulations
- Signal ratio and bonus dependency must be computed on the fly from tournament arrays

### Agent prompts
- Sequential build stages with explicit STOP gates — agent reports before proceeding
- Data flow first, visual polish second
- `project_knowledge_search` before writing prompts
- `bash_tool` Python one-liners: `cat file.json | python3 -c` with `json.load(sys.stdin)`
- File delivery: `create_file` → `present_files`

### Communication
- Short, direct messages
- Premature conclusions are a friction point — treat mvc-web data as correct until proven otherwise with evidence
- Build sorted arrays first for percentile ranking

---

## CHANGELOG

| Date | Change |
|------|--------|
| 2026-03-22 | v1 created from 6 conversations + founder article |
| 2026-03-24 | v2: Agency model, card-per-tournament theory, tournament economics, activation math |
| 2026-03-31 | v3: Full ecosystem stats, on-chain verification results, sales data validation, Senti deck analysis, multi-wallet creators (8 total), holder snapshot stats, API endpoints confirmed, marketplace contracts verified, deployment architecture (Vercel + Railway), Railway PORT=8080 and DB_PATH=/tmp/xeet.db notes |
