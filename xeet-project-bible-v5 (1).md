# XEET PROJECT BIBLE v5
## Last updated: 2026-04-13

> **Purpose**: Single source of truth for any agent or conversation working on Xeet market intelligence. Read this before asking questions or writing code.

---

## 1. WHAT IS XEET

### 1.1 Platform Overview

Xeet is a **results-based marketing platform** built on the **Abstract blockchain** (chain ID 2741). It connects brands with creators through a tournament system where verified outcomes (not engagement) earn rewards.

The founder's thesis: "Paying for engagement is not paying for outcomes." The platform keeps the distribution mechanics of InfoFi, the identity/access layer of SocialFi, and the outcome alignment of affiliate marketing — but structures incentives so the only way to win is to drive verified results through coordinated teams.

### 1.2 Core Concepts

**Creator Cards (ERC-1155 NFTs)**
- Contract: `0xeC27D2237432D06981e1F18581494661517E1bD3` on Abstract (chain 2741)
- Every Xeet Certified Creator (XCC) has cards in up to 5 rarity tiers: Common, Rare, Legendary, Epic, Mythic
- Currently only Common, Rare, and Legendary exist in circulation
- Epic and Mythic confirmed to exist — acquisition method unknown
- Cards trade on: **Xeet Marketplace** (XEETS) and **OpenSea** (ETH/WETH)
- ERC-1155: multiple units of same rarity share a single token_id

**Squads & Tournaments (V2 — not yet live)**
- Brands define tournaments with specific KPIs
- Card ownership = access ticket to join a creator's squad
- One squad per tournament, no hedging
- Rewards based on verified results, not posts or engagement

**XEETS Token**
- 2% burn on every XEETS-denominated sale on Xeet MP
- `xeetEarned` on leaderboard API = current live wallet balance (NOT historical earnings)
- `totalPoints` in user tournament endpoint = actual XEETS earned per tournament

### 1.3 Card Supply & Distribution

- Max supply per creator: 250 cards (all rarities combined)
- Current circulating: ~1/3 of maximum (~31,699 across 391 creators)
- ~3,875 unique holder wallets
- Pack 1 sold: 10K common, 3.5K rare, 1K legendary packs

---

## 2. V2 GAME THEORY — OUR WORKING MODEL

### 2.1 The Agency Model
Squad = marketing agency. Leader = CEO, sub-leaders (XCCs) = department heads, active holders = staff, passive holders = silent partners. Card is agency equity.

### 2.2 One Card Per Tournament (Working Theory)
One card = one tournament entry. Creates demand pressure on supply. Burns/crafting = resource management.

### 2.3 Cross-Squad Yield — Ruled Out
Hedging contradicts founder's article. Multi-card value only within same squad tree.

### 2.4 Secondary Reach via Sub-Squads
Hold Creator B's card → B joins Creator A's squad → you enter through B. Core concept behind Deck Reach Score app.

### 2.5 Creator Activation Math
~25% activation rate healthy by TCG standards. 8 concurrent tournaments → ~34% XCCs active, ~65% wallets engaged, ~38% supply locked.

---

## 3. V1 vs V2 DISTINCTION — CRITICAL

**V1 bonuses have NOTHING to do with cards.** V1 multipliers were project-specific on-chain activity (hold their NFT, use their product). Completely different from V2 card mechanics.

**However, multiplier consistency across different projects IS a useful signal.** A creator who earned multipliers in Blinko (play the game), Myriad (use the DEX), and IOPn (engage with infra) shows broad project alignment. This indicates willingness to go deep on projects — relevant for V2 squad leadership where you need to understand the brand you're promoting.

**What V1 data IS useful for:**
- Signal ratio (signalPoints/totalPoints) — content quality
- Consistency across tournaments — reliable performers
- Performance vs difficulty — who performs well when competition is real
- Crypto Creator tournament as standalone content quality signal (longest running, pure organic)

**What V1 data CANNOT predict:**
- Squad leadership ability
- Performance under V2 verified-outcome KPIs
- Squad recruitment and coordination skills

---

## 4. TOURNAMENT DATA — VERIFIED (MCP + API)

### 4.1 Data Collected

**33 tournaments** with full data from MCP website browsing + API leaderboard pagination:
- Real participant counts (≥1 XEET earned, verified against website UI)
- Total XEETS distributed per tournament
- Median and average XEETS per participant
- Top 10 concentration percentage
- Reward details (USD, tokens, NFTs, vesting terms)
- Eligible winners (Top 10, Top 50, Top 100, etc.)
- Win rate (eligible / real participants)
- Tournament niche (Gaming, DeFi, NFT/Art, Infrastructure, Social, Platform)
- Multi-drop tournaments broken out by drop (IOPn 3 drops, ADI 2 drops, Xeet 2 drops, VDEX 2 drops)

### 4.2 Tournament Quality Hierarchy

**High signal tournaments (for performance evaluation):**
- Brand-sponsored with real prizes and low win rates
- IOPn Drop 1 (4,889 real, 2% win rate, $300K $OPN)
- Solstice (4,607 real, 2.2% win rate, 1% $SLX)
- Xyber (2,134 real, 4.7% win rate, $250K USDT)
- Crypto Creator (89,655 real, pure content quality signal — standalone metric)

**Medium signal:**
- Most brand tournaments with moderate competition and Top 100 eligible

**Low/no signal (exclude or heavily discount):**
- Xeetsgiving — 3 days, everyone wins, zero competitive signal. **EXCLUDE from performance calculations entirely.**
- Cancelled tournaments (Cryptoys, ADI Drop 2, DataHaven) — no rewards distributed
- Platform tournaments (Abstract, Xeet InfoFi) — always-on, no brand rewards, useful for reach/activity only

### 4.3 Tournament Difficulty Metric

**Win rate (eligible winners / real participants) is the primary difficulty metric**, combined with participant count:
- IOPn Drop 1: 2.0% win rate (hardest)
- Cipher: 42.6% win rate (easiest brand tournament)
- Platform tournaments: 100% (everyone gets something)

**Participant count alone is misleading.** Cipher (235 people, Top 100 eligible = 42.6% win rate) is easier than Cockio (229 people, Top 10 eligible = 4.4% win rate) despite similar participant counts.

### 4.4 Casual Participation Filter

**Not all tournament entries should count for performance.** A creator who posted once about a project and earned 3 XEETS in a tournament with median 15 wasn't competing — they were casually mentioning it.

**Threshold:** Tournament median XEETS rounded UP to nearest 10.
- Blinko median 12 → threshold 20 XEETS
- Cockio median 3 → threshold 10 XEETS
- Solstice median 12 → threshold 20 XEETS
- Lute median 4 → threshold 10 XEETS

Below threshold = "casual participation" — counted in total XEETS but NOT in performance metrics (percentile, consistency, tournament count for scoring).

### 4.5 Key Tournament Stats

| Tournament | Real | XEETS | Avg | Median | Eligible | Win Rate | Niche |
|-----------|------|-------|-----|--------|----------|----------|-------|
| Crypto Twitter | 89,655 | 16,967,202 | 189 | 32 | Everyone | 100% | Platform |
| IOPn (Drop 1) | 4,889 | 137,539 | 28 | 14 | Top 100 | 2.0% | Infra |
| Solstice | 4,607 | 134,496 | 29 | 12 | Top 100 | 2.2% | DeFi |
| Myriad | 2,800 | 171,736 | 61 | 19 | Top 500 | 17.9% | DeFi |
| Xyber | 2,134 | 51,599 | 24 | 15 | Top 100 | 4.7% | Infra |
| Claynosaurz | 1,500 | 58,565 | 39 | 9 | Top 50 | 3.3% | NFT |
| Blinko | 451 | 68,809 | 153 | 12 | Top 50 | 11.1% | Gaming |
| Cockio | 229 | 6,403 | 28 | 3 | Top 10 | 4.4% | Gaming |

---

## 5. XCC SCORING SYSTEM — IN DESIGN

### 5.1 Strategic Thesis (from Senti's analysis)

**4 tiers of cards:**
- **A (Mythic):** Perceived squad leaders. Price already reflects this. ~10-15 creators.
- **B (Legendary/Epic):** Will perform as expected or better. Solid track record but not obvious picks. **This is where the alpha is.**
- **C (Rare):** Will participate but stuck in old infofi model, can't coordinate squads.
- **D (Common):** Won't really participate. Dead weight.

**Trading thesis:** Upgrade D and C cards to B before V2 launches. A tier is already priced in. Focus on identifying B tier — creators the market undervalues.

**Key insight:** "A common of someone who's active and performs gives higher return than a legendary of someone who doesn't."

### 5.2 Proposed Dimensions (to be validated by data exploration)

**Performance (P):** Tournament percentile weighted by difficulty (win rate + participant count). Signal ratio. Crypto Creator as standalone quality signal. Casual participation filtered out (below median threshold).

**Reliability (R):** Tournament count (competitive entries only). Consistency (low percentile variance). Niche diversity.

**Market (M):** Scarcity (supply vs 250 cap). Collector density. Liquidity (trade frequency). Floor price position.

**Activity/Engagement (A):** Cards in their wallet (ecosystem investment). Deck reach score. Bridge value. Multiplier breadth (earned multipliers across different projects — shows project alignment willingness).

### 5.3 What the Data Agent Should Do

**DO NOT prescribe the formula.** Instead:
1. Run correlations across all available data
2. Find natural clustering among 391 creators
3. Test our intuitions against the data
4. Propose dimensions and weights based on what actually predicts creator quality
5. Validate against gut-feel Mythic list (sanity check)

### 5.4 Gut-Feel Mythic Candidates (sanity check for clustering)

| Creator | Handle | XEETS | Tournaments | Best Rank |
|---------|--------|-------|-------------|-----------|
| Ely | @ProofOfEly | 30,110 | 19 | #1 |
| Chesus | @chesus | 21,421 | 20 | #1 |
| Josh Ong | @beijingdou | 19,709 | 36 | #1 |
| wale.moca | @waleswoosh | 15,528 | 14 | #3 |
| Lizzie | @lizmoneyweb | 14,303 | 28 | #1 |
| IcoBeast | @icobeast | 10,658 | 8 | #12 |
| Wals | @walsxbt | 10,531 | 19 | #1 |
| tut | @Tuteth_ | 10,127 | 14 | #4 |
| VonDoom | @CryptoVonDoom | 9,620 | 25 | #1 |
| LoKi | @lokithebird | 7,900 | 8 | #9 |
| R2D2 | @R2D2zen | 4,658 | 12 | #7 |

These should cluster near the top. If any land in C or D tier, the model needs to explain why.

### 5.5 Formula Lab (Product Feature)

User-facing page with adjustable dimension weights. Presets for different strategies. Cards reshuffle in real time. Wallet overlay shows holdings and deck strength.

Tier naming: **Mythic / Legendary / Epic / Rare / Common** (matching Xeet's rarity names but representing performance tiers). Number of tiers determined by natural data clustering.

### 5.6 Hearthstone-Style Card Design

- Portrait card with creator pfp as artwork
- Xeet butterfly logo top center, dark charcoal frame (#2c2c30)
- 4 score corners with icon + number (no letters)
- Hexagonal faceted crystal gem at center for tier indicator (color changes by tier)
- Click to flip — 3D rotation to card back with auto-generated commentary
- Full design spec in: `xcc-card-design-decisions.md`

---

## 6. DATA INVENTORY

### 6.1 Primary Datasets

| File | Contents | Status |
|------|----------|--------|
| xeet-creators-full.json | 391 creators, all V1 tournament data | Canonical, verified |
| xeet-creators-enriched.json | Same + percentile fields per tournament | Verified (but tournamentSize from API is inflated) |
| tournament-difficulty-data.json | 33 tournaments: real participants, XEETS, rewards, niches | NEW — from MCP, verified |
| tournament-difficulty-table.csv | Sortable tournament comparison | NEW — from MCP |
| xeet-api-reference.md | Documented API endpoints + scraping guide | NEW — from MCP |

### 6.2 XEETS Field Distinction — CRITICAL

- `totalXeetEarned` in creator JSON = snapshot at pull time. STALE.
- `derived.totalXeetsAllTime` = sum of tournament totalPoints. RELIABLE.
- `xeetEarned` on leaderboard API = current live wallet balance, NOT historical.
- `totalPoints` in leaderboard = tournament-specific score, displayed as Math.round() on website.
- Per-tournament XEETS = `totalPoints` from `/api/user/handle/{username}/tournaments`.

### 6.3 Sales Data (SQLite: xeet.db)

- ~2,975 Xeet MP sales + ~12,000+ OpenSea sales (re-backfilled to full history)
- Currency values: 'ETH', 'WETH', 'XEETS'
- OS backfill gap FIXED — was capped at 10K, re-ran per-token backfill for full history
- ERC-1155 purchase matching: use tx_hash, NOT buyer field (buyer can be proxy/conduit)

### 6.4 Holder Data

- holder-snapshot.json: 3,875 wallets, 31,699 cards
- creator-holdings.json: XCC cross-holdings (derived live from holder snapshot)
- multi-wallet-creators.json: 8 creators with alt wallets

### 6.5 APIs (Key Endpoints)

**Xeet (no auth):**
- `/api/topics/{slug}` — tournament metadata (WARNING: returns ACTIVE/LATEST tournament, not necessarily Drop 1)
- `/api/topics/{slug}/tournament?page=N&limit=50&timeframe=all&tournamentId={tid}` — leaderboard (limit 50, need tournamentId from page URL)
- `/api/topics?status=completed&limit=50&page=N` — completed tournaments list
- `/api/tournaments/{tournamentId}/reward-distribution` — reward details
- `/api/user/handle/{h}/header` — profile
- `/api/user/handle/{h}/tournaments` — per-tournament performance

**Key API lessons:**
- Three different IDs: topicId ≠ tournamentId ≠ league.id
- Always get tournamentId from page URL, not from /api/topics/
- Leaderboard "Xeets" column = Math.round(totalPoints), NOT xeetEarned
- meta.total includes zeros — real participants require checking totalPoints ≥ 1

---

## 7. SENTI'S PROFILE

### Deck (April 2026)

| Metric | Value |
|--------|-------|
| Total cards | 149 (117 creator:rarity entries) |
| Direct creators | ~111 |
| Total reach | ~386 / 391 (98.7%) |
| Cards with OS purchase records | 85 |
| Cards from mints/packs/transfers | 64 |

### Tournament Performance
- 4,577.40 XEETS across 14 tournaments
- **Competitive entries** (above median threshold): ~3-4 (Blinko, Crypto Creator, Xeet InfoFi)
- Best: Blinko rank #13 (2.5x multiplier, 1,576 XEETS)
- Highest signal: Crypto Creator 96%

### Trading Thesis
Upgrade D and C tier cards to B tier before V2 launches. A tier already priced in. Liquidity constraint — trading cards for cards, not buying with fresh ETH.

---

## 8. OPEN QUESTIONS

| Question | Status |
|----------|--------|
| One card per tournament or covers all? | Working theory: one per tournament |
| V2 reward flow through sub-squads? | Wait for V2 launch |
| V2 rarity multipliers? | Unknown |
| Epic/Mythic acquisition method? | Unknown |
| Epic/Mythic card colors? | Not in circulation yet, no design assets found |
| How many natural creator tiers? | Data agent to determine via clustering |
| Optimal formula dimensions and weights? | Data agent to explore and propose |

---

## 9. ACTIVE WORKSTREAMS

### In Progress
1. **Data exploration agent** — analyze full dataset, find natural clustering, propose formula (prompt being written)
2. **Deck reach features** — bug fix (bestPicks sort by value), deck valuation, rarity upgrades, cost basis
3. **OS sales re-backfill** — completion flag cleared, per-token backfill re-running

### Next Up
1. Formula engine implementation (after agent proposes and we validate)
2. Hearthstone-style card component
3. Collection grid with filters
4. Formula Lab (interactive weight sliders)

### Deferred
- Total XEETS distributed per tournament via full participant sweep (thousands of API calls)
- Tournament participant count filtering via per-user API calls
- Social/semantic analysis (Twitter API expensive, semantic analysis complex)
- Squad Game visual content series
- Telegram bot

---

## 10. CONVENTIONS & PATTERNS

### Data handling
- Handle lookup: normalize to lowercase before cross-referencing
- Signal ratio and bonus dependency computed on the fly from tournament arrays
- ERC-1155: multiple units share token_id — can't distinguish individual units
- Purchase matching: use tx_hash, NOT buyer address
- Casual participation filter: exclude tournament entries below median threshold (rounded up to nearest 10)
- Xeetsgiving: exclude entirely from performance calculations

### Agent prompts
- Sequential stages with STOP gates
- Separate agents for separate tasks
- Data flow first, visual polish second
- V1 bonuses ≠ card mechanics — correct immediately if conflated
- XCC vs non-XCC density is NOT a tournament difficulty metric

---

## CHANGELOG

| Date | Change |
|------|--------|
| 2026-03-22 | v1: Initial from 6 conversations + founder article |
| 2026-03-24 | v2: Agency model, card-per-tournament theory, economics |
| 2026-03-31 | v3: Ecosystem stats, on-chain verification, sales validation, deployment |
| 2026-04-11 | v4: Tournament data verified, OS backfill fix, ERC-1155 matching, formula spec, card design |
| 2026-04-13 | v5: MCP tournament data integrated (real participants, XEETS distributed, rewards, niches, win rates), casual participation filter defined, tournament quality hierarchy, Xeetsgiving excluded, Crypto Creator as standalone signal, gut-feel Mythic list, Senti's trading thesis (D/C→B upgrade), card design prototype (charcoal frame + hexagonal crystal), data agent approach for formula discovery, multiplier breadth as alignment signal, API reference documented |
