# The Xeet Co-Efficient: A Multi-Dimensional Framework for Creator Card Valuation

**Version 4.0 | April 2026**

---

## Abstract

The Xeet Co-Efficient is a composite scoring formula that ranks 391 Xeet Certified Creators (XCCs) across four dimensions: Performance, Ecosystem Alignment, Reach Efficiency, and Market. Built from 33 tournament datasets, 16,467 marketplace sales, and on-chain holder data, the formula reveals that current market pricing explains only 11% of tournament performance variance — meaning the market mostly prices on name recognition, not results. The Co-Efficient surfaces this gap, identifying creators whose competitive track record the market has not yet priced in, and assigns each creator to one of five tiers: Mythic, Legendary, Epic, Rare, or Common.

---

## 1. Introduction

### 1.1 What is Xeet?

Xeet is a results-based marketing platform on Abstract blockchain where brands run tournaments and creators compete to drive verified outcomes. Each of the 391 Xeet Certified Creators has ERC-1155 trading cards in three rarity tiers (Common, Rare, Legendary), with a fourth and fifth tier (Epic, Mythic) confirmed but not yet in circulation.

### 1.2 Why Valuation Matters Now

Xeet's V2 system — squad-based tournaments with verified-outcome KPIs — has not yet launched. When it does, card ownership becomes the access ticket to join a creator's squad. This means card value will be driven by creator performance, not just collectibility.

The current market doesn't know this yet. Cards trade on OpenSea and the Xeet Marketplace based on name recognition, follower counts, and card rarity. Our analysis found that **marketplace floor prices have an r-squared of just 0.109 with tournament performance** — the market explains barely one-tenth of the variance in how well creators actually perform.

This gap is the opportunity. A common card of someone who consistently finishes in the top 5% of tournaments is worth more than a legendary card of someone who hasn't competed since October. The Xeet Co-Efficient quantifies this.

### 1.3 Design Principles

1. **Performance-first.** 42% of the composite score comes from competitive tournament results. The formula rewards creators who show up and win, not creators who are famous.
2. **Market as confirmation, not driver.** Market data carries only 15% weight. It tells us whether the market agrees with the formula — not the other way around.
3. **Efficiency over vanity.** Follower counts are balanced against XEETS-per-follower (XPF). A 3,000-follower creator who earns 5,000 XEETS is more impressive than a 150,000-follower creator who earns the same.
4. **Casual participation filtered.** Not every tournament entry is a real competition. Creators who posted once about a project and earned 3 XEETS in a tournament with a median of 15 were not actually trying. The formula filters these out.

---

## 2. Methodology

### 2.1 Data Collection

| Source | Records | Description |
|--------|---------|-------------|
| Creator tournament data | 391 creators, ~2,700 tournament entries | Rank, XEETS earned, signal/noise/bonus points, multiplier per tournament |
| Tournament difficulty | 33 tournaments | Real participant counts (MCP-verified), median XEETS, win rates, reward structures |
| Marketplace sales | 16,467 transactions | OpenSea + Xeet MP sales with price, currency, buyer, seller, timestamp |
| Floor prices | 391 creators x 3 rarities | Current OS/Xeet floor, last sale, best offer |
| Holder data | 3,875 wallets, 31,699 cards | On-chain card holdings per wallet |
| Creator holdings | 386 creators | Which cards each creator holds in their own wallet |
| Deck scores | 3,867 wallets | Network reach through card holdings |

**Critical data distinction:** Tournament participant counts from the Xeet API (`meta.total`) are inflated — they include users with zero XEETS. We verified real participant counts (users with at least 1 XEET earned) directly from the Xeet website via MCP browser automation. For example, the Solstice tournament reports 12,000+ in the API but has 4,607 real participants.

### 2.2 The Casual Participation Filter

Not all tournament entries represent genuine competition. A creator who earned 4 XEETS in a tournament where the median was 15 wasn't trying — they posted once or twice about the project to inform their audience, not to compete.

The filter uses two independent checks. An entry is flagged as casual if it fails **either** one:

**Filter 1 — XEETS threshold (did you earn enough?)**

For each tournament with median XEETS earned M:

> XEETS Threshold = ceil(M / 10) x 10

If a creator earned less than the threshold, they weren't generating meaningful output.

| Tournament | Median | Threshold | Effect |
|-----------|--------|-----------|--------|
| Blinko | 12 | 20 | Below 20 XEETS = casual |
| Cockio | 3 | 10 | Below 10 XEETS = casual |
| Solstice | 12 | 20 | Below 20 XEETS = casual |
| Crypto Creator | 32 | 40 | Below 40 XEETS = casual |
| Myriad | 19 | 20 | Below 20 XEETS = casual |

**Filter 2 — Rank threshold (did you actually compete?)**

A creator who earns above the XEETS threshold but finishes far outside the reward cutoff wasn't truly competing — they participated casually despite accumulating some XEETS.

> Rank Threshold = eligible_winners x 3

For brand tournaments, `eligible_winners` is the reward cutoff (Top 100, Top 50, etc.). Ranking beyond 3x this cutoff means you were never close to winning.

**Crypto Creator and Xeet InfoFi are exempt from the rank filter.** These platform tournaments measure organic content quality without prize incentives — every entry represents genuine effort, regardless of final rank. A creator who earned 1,400 XEETS and ranked #1,505 out of 89,655 in Crypto Creator was producing real content at a high level. Abstract, by contrast, applies the rank filter (top 500) since it is a shorter, less meaningful platform tournament.

| Tournament | Eligible | Rank Cutoff | Effect |
|-----------|----------|------------|--------|
| Solstice | Top 100 | 300 | Rank > 300 = casual |
| Claynosaurz | Top 50 | 150 | Rank > 150 = casual |
| Chimpers | Top 20 | 60 | Rank > 60 = casual |
| Abstract | All | 500 | Rank > 500 = casual |
| Myriad | Top 500 | 1,500 | Rank > 1,500 = casual |
| Crypto Creator | All | **Exempt** | XEETS threshold only |
| Xeet InfoFi | All | **Exempt** | XEETS threshold only |

The rank filter catches a different pattern than the XEETS filter. A creator with a large following might earn 50 XEETS in Chimpers (above the XEETS threshold of 10) just by posting once about it to their audience — but ranking #166 out of a Top 20 eligible tournament means they were nowhere near competing. The XEETS filter passes them; the rank filter catches them.

Additionally, these categories are excluded entirely from performance calculations:

- **Xeetsgiving** — a 3-day participation event where everyone earned XEETS. Zero competitive signal.
- **Cancelled tournaments** (Cryptoys, ADI Drop 2, DataHaven) — no rewards were distributed.
- **Orphan tournaments** (Grimmy, Vault777) — no difficulty data available to compute percentiles.

### 2.3 Rank Normalization

All raw signals are converted to a 0-100 scale using rank-based normalization before weighting. For a signal measured across n creators with non-null values:

> RN(x) = (rank(x) - 1) / (n - 1) x 100

This approach is robust to the extreme right-skewness of most signals (e.g., total XEETS ranges from 0 to 30,074 with a median of 1,664), and ensures each signal contributes proportionally regardless of its natural scale.

---

## 3. The Formula

### 3.1 Composite Score

> **Xeet Co-Efficient = P(0.42) + A(0.23) + R(0.20) + M(0.15)**

where P = Performance, A = Ecosystem Alignment, R = Reach Efficiency, M = Market.

Each dimension produces a 0-100 score. The Performance score is then multiplied by a **confidence multiplier** based on competitive tournament count before entering the composite:

| Competitive Entries | Multiplier | Rationale |
|---|---|---|
| 8+ | 1.0x | Full confidence — proven track record |
| 5-7 | 0.9x | Moderate sample — slight discount |
| 3-4 | 0.8x | Thin record — significant discount |
| 1-2 | 0.7x | Minimal data — heavy discount |
| 0 | 0.0x | No competitive entries — Performance = 0 |

This prevents creators with 3 lucky tournament entries from ranking alongside those with 15+ consistent performances.

### 3.2 Effective Weight Map

Every signal flows through its dimension weight and its within-dimension weight to produce an effective weight on the composite:

| Rank | Signal | Dimension | Dim Wt | Sig Wt | Effective |
|------|--------|-----------|--------|--------|-----------|
| 1 | Avg Difficulty-Adjusted Percentile | Performance | 42% | 35% | **14.7%** |
| 2 | Organic XEETS (signal+noise, no bonus) | Performance | 42% | 25% | **10.5%** |
| 3 | Competitive Tournament Count | Performance | 42% | 25% | **10.5%** |
| 4 | Deck Reach Score | Ecosystem | 23% | 35% | **8.05%** |
| 5 | Followers | Reach | 20% | 35% | **7.0%** |
| 6 | XPF (XEETS / Followers) | Reach | 20% | 35% | **7.0%** |
| 7 | Total Cards Held | Ecosystem | 23% | 30% | **6.9%** |
| 8 | Signal Ratio Average | Performance | 42% | 15% | **6.3%** |
| 9 | Niche Diversity | Reach | 20% | 30% | **6.0%** |
| 10 | Multiplier Breadth | Ecosystem | 23% | 20% | **4.6%** |
| 11 | OS Floor Price (Common) | Market | 15% | 25% | **3.75%** |
| 12 | ETH Sale Volume | Market | 15% | 25% | **3.75%** |
| 13 | Crypto Creator XEETS | Ecosystem | 23% | 15% | **3.45%** |
| 14 | Highest Sale (Common) | Market | 15% | 20% | **3.0%** |
| 15 | Price Trajectory | Market | 15% | 15% | **2.25%** |
| 16 | Sale Velocity (30d) | Market | 15% | 15% | **2.25%** |

---

## 4. The Four Dimensions

### 4.1 Performance (42%)

**What it measures:** How well does this creator perform when they actually compete?

This is the core of the Co-Efficient. V2 tournaments will reward verified outcomes, so past competitive performance is our best predictor of future value.

**Signals:**

**Average Difficulty-Adjusted Percentile (14.7%)** — For each competitive tournament entry, we compute the creator's percentile: 1 minus their rank divided by real participants. A creator who ranked #50 out of 4,889 in IOPn Drop 1 (a brutal 2% win rate tournament) scores a 0.99 percentile — far more impressive than ranking #50 out of 235 in Cipher (42.6% win rate). The average across all competitive entries captures sustained quality.

Ely scores 93.6 on Performance partly because his average percentile is 0.989 — he typically finishes in the top 1-2% of participants regardless of tournament difficulty.

**Total XEETS (10.5%)** — Lifetime XEETS earned, excluding Xeetsgiving and cancelled tournaments. This captures raw earning power. Ely leads with 30,074 XEETS; the median creator has earned 1,664.

**Competitive Tournament Count (10.5%)** — Number of tournaments where the creator competed above the casual threshold. This measures reliability. Beijing has 30 competitive entries — more than anyone else — showing he doesn't just perform well, he shows up consistently.

**Signal Ratio (6.3%)** — The ratio of signal points to total points, averaged across competitive entries. Signal points come from organic content quality. Noise and bonus points come from engagement mechanics and V1 project-specific multipliers. A high signal ratio (0.8+) means the creator's content itself drives results, not just gaming the system. Tma_420 leads at 0.906.

### 4.2 Ecosystem Alignment (23%)

**What it measures:** How invested is this creator in the XCC ecosystem, and how broadly do they align with projects?

This dimension was originally called "Engagement" and contained only deck reach, own cards, and Crypto Creator XEETS. We moved **multiplier breadth** here from Performance because it measures the same thing as the other signals: skin in the game. A creator who held Blinko's NFTs (to earn a multiplier), used Myriad's DEX, AND engaged with IOPn's infrastructure is showing project alignment — the same signal as buying cards and building deck reach.

**Signals:**

**Deck Reach Score (8.05%)** — How many of the 391 creators a wallet can access through card holdings, both directly and through secondary connections. In V2, this determines squad optionality. lokithebird scores 99.2 (holds cards from nearly everyone), while creators with no cards in their wallet score near zero.

**Total Cards Held (6.9%)** — The total number of XCC cards a creator holds from other creators. A creator who bought 140 cards from other creators is deeply invested in the ecosystem. lizmoneyweb leads with 345 cards held; many creators hold fewer than 5.

**Multiplier Breadth (4.6%)** — The count of distinct non-platform tournaments where the creator earned a V1 multiplier (by holding the project's NFT, using their product, etc.). Beijing leads at 10 — he went deep on 10 different projects. This signals willingness to understand brands, which is critical for V2 squad leadership.

**Crypto Creator XEETS (3.45%)** — Performance in the Crypto Creator tournament specifically. This tournament ran for 219 days with 89,655 real participants, XEETS-only rewards, and no brand incentives. It is the purest measure of organic content creation ability independent of any specific project.

### 4.3 Reach / Efficiency (20%)

**What it measures:** How efficiently does this creator convert audience into outcomes?

The key innovation here is balancing raw follower count against XEETS-per-follower (XPF). A 2,000-follower creator with 5,000 XEETS (XPF = 2.5) extracts far more value per follower than a 100,000-follower creator with the same XEETS (XPF = 0.05). In V2, where verified outcomes matter, conversion efficiency predicts performance better than audience size alone.

**Signals:**

**Followers (7.0%)** — Raw X (Twitter) follower count. A necessary but insufficient condition for influence.

**XPF — XEETS Per Follower (7.0%)** — Total XEETS divided by followers. The top XPF creators are small but mighty: OODEGEN (XPF 2.52, 1,303 followers), HarrietPJones (XPF 1.87, 6,814 followers), Senti (XPF 1.67, 2,728 followers). These creators punch massively above their weight.

Equal weighting (35/35) between followers and XPF ensures creators need both reach AND efficiency. Pure XPF would over-reward tiny accounts; pure followers would reward vanity.

**Niche Diversity (6.0%)** — Count of distinct tournament niches (Gaming, DeFi, NFT/Art, Infrastructure, Social, Science) across competitive entries. A creator who excels across DeFi AND Gaming AND Infrastructure is more versatile as a V2 squad member than one who only knows one vertical.

### 4.4 Market (15%)

**What it measures:** Does the market agree this creator is valuable?

This dimension is deliberately underweighted. Our correlation analysis found the market-performance r-squared is 0.109 — the market explains only 11% of performance variance. It prices primarily on name recognition, follower counts, and card rarity. We include market data as a confirmation signal, not a driver.

When a creator scores high on Performance but low on Market, that's not a flaw in the formula — it's the alpha. Those are the undervalued cards.

**Signals:**

**OS Floor Price, Common (3.75%)** — Current OpenSea floor price in ETH. Ely leads at 0.080 ETH.

**ETH Sale Volume (3.75%)** — Total historical ETH + WETH trading volume. waleswoosh leads at 3.10 ETH total volume.

**Highest Sale, Common (3.0%)** — Peak price paid for a common card. Reflects maximum buyer conviction.

**Price Trajectory (2.25%)** — Slope of the last 10 OS sales over time. Positive means the price is rising. Most creators show negative trajectories in the current market.

**Sale Velocity, 30d (2.25%)** — Number of ETH sales in the last 30 days. Measures current liquidity and demand.

---

## 5. The Formula Lab Concept

The Xeet Co-Efficient is not meant to be a fixed ranking. Different strategies value different dimensions. The Formula Lab is a planned frontend feature where users adjust 8 weight groups via sliders and see tier assignments reshuffle in real time.

### 5.1 Adjustable Weight Groups

| Group | Signals | Default Weight |
|-------|---------|---------------|
| Tournament Quality | avgPercentile | 14.7% |
| Tournament Volume | totalXeets + competitiveTournamentCount | 21.0% |
| Content Quality | signalRatio | 6.3% |
| Ecosystem Investment | deckReach + ownCards + multiplierBreadth | 19.55% |
| Standalone Quality | cryptoCreatorXeets | 3.45% |
| Audience Efficiency | followers + XPF + nicheDiversity | 20.0% |
| Market Valuation | osFloor + ethVolume + highestSale | 10.5% |
| Market Momentum | priceTrajectory + saleVelocity30d | 4.5% |

### 5.2 Strategy Presets

**Balanced (default):** The formula as described. Best for general deck-building.

**Performance Hunter:** P=60%, A=20%, R=10%, M=10%. Maximizes tournament quality. Surfaces grinders who win regardless of popularity.

**Market Consensus:** P=25%, A=15%, R=15%, M=45%. Follows the market. For traders who believe floor price is the signal.

**Network Builder:** P=20%, A=45%, R=20%, M=15%. Maximizes deck reach and ecosystem alignment. For players optimizing squad access breadth.

**Alpha Seeker:** P=50%, A=25%, R=20%, M=5%. Minimizes market weight. Surfaces the biggest gap between performance and price — the undervalued cards.

---

## 6. Results

### 6.1 Tier Distribution

| Tier | Creators | Score Range | Avg Floor (ETH) | Avg XEETS |
|------|----------|-------------|-----------------|-----------|
| Mythic | 25 | 74.9 - 89.8 | 0.0164 | 11,367 |
| Legendary | 50 | 65.0 - 74.2 | 0.0084 | 6,466 |
| Epic | 75 | 53.4 - 64.8 | 0.0050 | 3,519 |
| Rare | 110 | 32.5 - 53.3 | 0.0030 | 1,381 |
| Common | 131 | 6.2 - 32.4 | 0.0029 | 308 |

### 6.2 Top 25 (Mythic Tier)

| Rank | Creator | Score | P | A | R | M | XEETS | Floor |
|------|---------|-------|---|---|---|---|-------|-------|
| 1 | ProofOfEly | 89.8 | 90.2 | 95.4 | 89.0 | 81.4 | 30,074 | 0.080 |
| 2 | lizmoneyweb | 87.9 | 92.4 | 95.7 | 79.4 | 74.9 | 14,280 | 0.035 |
| 3 | TimHaldorsson | 86.3 | 91.1 | 94.3 | 76.1 | 74.4 | 10,823 | 0.006 |
| 4 | waleswoosh | 81.9 | 82.2 | 85.2 | 76.6 | 82.9 | 15,498 | 0.048 |
| 5 | Tuteth_ | 81.6 | 84.5 | 84.5 | 76.5 | 75.8 | 10,127 | 0.007 |
| 6 | chesus | 81.5 | 73.5 | 94.7 | 84.6 | 79.7 | 21,397 | 0.025 |
| 7 | beijingdou | 81.2 | 75.7 | 90.9 | 83.5 | 78.8 | 19,692 | 0.027 |
| 8 | DjaniWhaleSkul | 80.5 | 76.4 | 94.2 | 76.2 | 76.5 | 9,943 | 0.006 |
| 9 | monitalan | 80.4 | 84.9 | 82.3 | 73.3 | 74.3 | 5,275 | 0.009 |
| 10 | Jampzey | 79.4 | 82.6 | 89.9 | 64.8 | 73.9 | 6,417 | 0.006 |
| 11 | Gyokeres_eth | 78.6 | 78.5 | 94.4 | 73.5 | 61.3 | 5,667 | 0.005 |
| 12 | Cryptowithkhan | 77.9 | 81.4 | 80.0 | 79.4 | 63.0 | 8,951 | 0.009 |
| 13 | camolNFT | 77.1 | 76.3 | 76.0 | 79.0 | 78.8 | 9,697 | 0.015 |
| 14 | mariannehere | 76.7 | 80.4 | 92.2 | 64.5 | 58.7 | 10,218 | N/A |
| 15 | CryptoVonDoom | 76.6 | 81.0 | 71.9 | 72.4 | 77.0 | 9,597 | 0.007 |
| 16 | pukerrainbrow | 76.4 | 82.6 | 65.5 | 72.5 | 80.9 | 10,909 | 0.010 |
| 17 | ProofOfTravis | 76.3 | 69.2 | 81.4 | 81.9 | 81.2 | 9,104 | 0.006 |
| 18 | greenytrades | 76.2 | 88.5 | 36.4 | 83.7 | 92.7 | 16,455 | 0.015 |
| 19 | TheCryptoProfes | 75.6 | 84.5 | 86.0 | 68.0 | 45.2 | 7,410 | 0.008 |
| 20 | zaddyfi | 75.6 | 76.3 | 83.4 | 76.9 | 59.5 | 6,592 | 0.004 |
| 21 | johnjassper | 75.5 | 81.5 | 82.8 | 73.1 | 50.7 | 6,682 | 0.002 |
| 22 | walsxbt | 75.4 | 69.9 | 80.8 | 82.5 | 73.0 | 10,510 | 0.024 |
| 23 | Pons_ETH | 75.2 | 86.5 | 35.5 | 88.0 | 87.4 | 17,922 | 0.037 |
| 24 | shivst3r | 75.1 | 78.0 | 69.4 | 80.3 | 68.7 | 11,708 | 0.006 |
| 25 | Hydraze420 | 74.9 | 80.4 | 68.2 | 71.9 | 73.5 | 7,324 | 0.007 |

### 6.3 The Alpha Picks

These are creators the market undervalues — strong Performance or Ecosystem scores but cheap floor prices.

**Cheap Mythics and high Legendaries with low floors:**

| Creator | Tier | Score | XEETS | Floor (ETH) | Why undervalued |
|---------|------|-------|-------|-------------|-----------------|
| TimHaldorsson | Mythic #3 | 82.3 | 10,823 | 0.006 | 0.991 avg percentile, floor is 5x below Mythic average |
| DjaniWhaleSkul | Mythic #8 | 80.5 | 9,943 | 0.006 | 94.2 Ecosystem, holds 355 cards |
| R2D2zen | Mythic #9 | 79.5 | 4,658 | 0.006 | 0.997 avg percentile from just 4 entries — elite quality |
| zaddyfi | Mythic #15 | 76.7 | 6,592 | 0.004 | 84.9 Performance, market hasn't noticed |

**Expensive low-tiers (overpriced):**

| Creator | Tier | Score | XEETS | Floor (ETH) | Why overpriced |
|---------|------|-------|-------|-------------|----------------|
| xeetdotai | Common | 31.4 | 50 | 0.020 | Platform account, not a competitor |
| Danny7xEth | Common | 36.2 | 189 | 0.017 | Name recognition pricing only |
| Sonika_KK | Common | 36.2 | 122 | 0.010 | Barely participated in tournaments |

### 6.4 Gut-Feel Mythic Validation

We tested the formula against 11 creators the community considers top-tier:

| Creator | Rank | Tier | Score | P | A | R | M |
|---------|------|------|-------|---|---|---|---|
| ProofOfEly | #1 | Mythic | 89.8 | 90.2 | 95.4 | 89.0 | 81.4 |
| lizmoneyweb | #2 | Mythic | 87.9 | 92.4 | 95.7 | 79.4 | 74.9 |
| waleswoosh | #4 | Mythic | 81.9 | 82.2 | 85.2 | 76.6 | 82.9 |
| Tuteth_ | #5 | Mythic | 81.6 | 84.5 | 84.5 | 76.5 | 75.8 |
| chesus | #6 | Mythic | 81.5 | 73.5 | 94.7 | 84.6 | 79.7 |
| beijingdou | #7 | Mythic | 81.2 | 75.7 | 90.9 | 83.5 | 78.8 |
| CryptoVonDoom | #15 | Mythic | 76.6 | 81.0 | 71.9 | 72.4 | 77.0 |
| walsxbt | #22 | Mythic | 75.4 | 69.9 | 80.8 | 82.5 | 73.0 |
| lokithebird | #28 | Legend | 73.7 | 67.0 | 84.9 | 67.0 | 84.0 |
| R2D2zen | #30 | Legend | 73.5 | 64.8 | 87.4 | 67.8 | 84.2 |
| icobeast | #45 | Legend | 69.7 | 76.8 | 52.7 | 73.5 | 71.2 |

8 of 11 land in Mythic. The dual casual filter (XEETS + rank), confidence multiplier, totalCardsHeld, and organic XEETS work together to produce accurate rankings. Crypto Creator and Xeet InfoFi are exempt from the rank filter — every entry in these organic platform tournaments represents genuine effort.

The three Legendaries:

- **lokithebird (#28):** Strong Ecosystem (A=84.9, holds 119 cards) but only 7 competitive entries → 0.9x confidence discount drops P from 74 to 67. Low Reach (R=67.0) from small niche diversity (3 niches).
- **R2D2zen (#30):** Elite raw percentile (0.997) but only 4 competitive entries → 0.8x confidence drops P from 81 to 65. Strong Ecosystem (A=87.4, 88 cards) and Market (M=84.2) keep him high Legendary. Needs more tournaments to prove consistency.
- **icobeast (#45):** Performance is strong (P=76.8, 0.9x confidence from 5 entries) but Ecosystem Alignment of 52.7 is the weakest among all candidates. Holds only 14 cards total (vs 100+ for most Mythics) and 0 multiplier breadth. If he invested more in the ecosystem, he'd be Mythic.

---

## 7. Limitations and Future Work

1. **V1 is not V2.** Tournament performance based on content posting may not predict performance under V2's verified-outcome KPIs. Squad leadership, coordination, and brand understanding are not captured by any V1 data.

2. **No engagement rate data.** Follower counts without likes, retweets, or impressions are an imperfect proxy for reach. XPF partially compensates but Twitter API access would enable true engagement-adjusted reach metrics.

3. **Static snapshot.** Floor prices, sales data, and holder snapshots are point-in-time. The formula should be re-run periodically as new tournaments complete and market conditions change.

4. **Casual filter is heuristic.** The median-rounded-up threshold catches approximately 90% of casual entries but misses borderline cases where a creator earned just above the threshold with minimal effort. Manual overrides address known exceptions.

5. **No burn/craft mechanics.** V2 may introduce card burning or crafting that changes supply dynamics. The formula does not account for future supply-side changes.

6. **Signal ratio interpretation.** High bonus points in V1 came from project-specific on-chain activity, not card mechanics. A creator with low signal ratio may have been deeply engaged with projects (earning multipliers) rather than gaming the system. The formula accounts for this by placing multiplier breadth in Ecosystem Alignment rather than penalizing it in Performance.

---

## Appendix A: Complete Signal Reference

### A.1 Performance Signals

| Signal | Effective Wt | Source | Formula |
|--------|-------------|--------|---------|
| avgDifficultyAdjustedPercentile | 14.7% | creators JSON + difficulty JSON | mean(1 - rank/realParticipants) across competitive entries |
| totalXeetsExclXeetsgiving | 10.5% | creators JSON tournaments[].totalPoints | Sum excluding Xeetsgiving + cancelled |
| competitiveTournamentCount | 10.5% | computed | Count of entries passing casual filter |
| signalRatioAvg | 6.3% | creators JSON tournaments[].signalPoints/totalPoints | Mean across competitive entries |

### A.2 Ecosystem Alignment Signals

| Signal | Effective Wt | Source | Formula |
|--------|-------------|--------|---------|
| deckReachScore | 8.05% | deck-scores.json | Pre-computed network reach score |
| totalCardsHeld | 6.9% | creator-holdings.json | Count of own-creator cards held (multi-wallet merged) |
| multiplierBreadth | 4.6% | creators JSON tournaments[].multiplier | Count of distinct non-platform tournaments with multiplier > 1 |
| cryptoCreatorXeets | 3.45% | creators JSON tournament where slug=crypto-creator | totalPoints in Crypto Creator tournament |

### A.3 Reach / Efficiency Signals

| Signal | Effective Wt | Source | Formula |
|--------|-------------|--------|---------|
| followers | 7.0% | creators JSON followers | Raw X follower count |
| XPF | 7.0% | computed | totalXeetsExclXeetsgiving / followers |
| nicheDiversity | 6.0% | computed from difficulty JSON niches | Count of distinct niches across competitive entries |

### A.4 Market Signals

| Signal | Effective Wt | Source | Formula |
|--------|-------------|--------|---------|
| osFloorCommon | 3.75% | floor-prices.json | Current OS floor price (ETH) |
| ethSaleVolume | 3.75% | xeet.db sale_history | Sum of ETH+WETH sales |
| highestSaleCommon | 3.0% | xeet.db sale_history | MAX(price) for common rarity |
| priceTrajectory | 2.25% | xeet.db sale_history | Linear regression slope of last 10 sales |
| saleVelocity30d | 2.25% | xeet.db sale_history | Count of ETH sales in last 30 days |

---

## Appendix B: Tournament Difficulty Table

| Tournament | Real Participants | Win Rate | Median XEETS | Casual Threshold | Niche |
|-----------|------------------|----------|-------------|-----------------|-------|
| Crypto Creator | 89,655 | 100% | 32 | 40 | Platform |
| IOPn Drop 1 | 4,889 | 2.0% | 14 | 20 | Infrastructure |
| Solstice | 4,607 | 2.2% | 12 | 20 | DeFi |
| Abstract | 4,620 | 100% | 33 | 40 | Platform |
| Myriad | 2,800 | 17.9% | 19 | 20 | DeFi |
| Xyber | 2,134 | 4.7% | 15 | 20 | Infrastructure |
| Lute | 1,812 | 27.6% | 4 | 10 | Gaming |
| Kona | 1,602 | 6.2% | 15 | 20 | Social |
| Claynosaurz | 1,500 | 3.3% | 9 | 10 | NFT/Art |
| Valannia | 1,374 | 7.3% | 6 | 10 | Social |
| DataHaven | 1,297 | N/A | 12 | 20 | Cancelled |
| IOPn Drop 2 | 1,229 | 8.1% | 3 | 10 | Infrastructure |
| Artery | 1,217 | 8.2% | 4 | 10 | NFT/Art |
| ADI | 1,194 | 8.4% | 10 | 10 | Cancelled |
| Mezo | 1,190 | 8.4% | 6 | 10 | Infrastructure |
| DeSci News | 980 | 2.6% | 3 | 10 | Science |
| VDEX | 952 | 15.8% | 2 | 10 | DeFi |
| Fight | 802 | 12.5% | 7 | 10 | Social |
| Thrust | 689 | 21.8% | 4 | 10 | Gaming |
| IOPn Drop 3 | 680 | 14.7% | 5 | 10 | Infrastructure |
| WoW | 563 | 8.9% | 6 | 10 | NFT/Art |
| Project Zero | 535 | 18.7% | 12 | 20 | Infrastructure |
| Blinko | 451 | 11.1% | 12 | 20 | Gaming |
| GVC | 446 | 5.6% | 8 | 10 | NFT/Art |
| LitVM | 426 | 23.5% | 24 | 30 | Infrastructure |
| Megaweapon | 411 | 24.3% | 8 | 10 | Gaming |
| Chimpers | 406 | 4.9% | 6 | 10 | NFT/Art |
| Onsight | 387 | 25.8% | 9 | 10 | Infrastructure |
| Gamblr | 368 | 27.2% | 9 | 10 | Gaming |
| Santa Browser | 302 | 24.8% | 20 | 20 | Infrastructure |
| Cipher | 235 | 42.6% | 22 | 30 | Infrastructure |
| Cockio | 229 | 4.4% | 3 | 10 | Gaming |
| Cryptoys | 107 | N/A | N/A | N/A | Cancelled |

---

## Appendix C: Version History

| Version | Date | Key Changes |
|---------|------|-------------|
| v1 | 2026-04-13 | Initial formula. P=40%, M=25%, E=20%, R=15%. Raw followers. cryptoCreatorXeets duplicated. |
| v2 | 2026-04-13 | Market reduced to 15%. Followers replaced with XPF. avgPercentile boosted. 5 tiers. |
| v3 | 2026-04-13 | XPF balanced with followers (35/35). Manual casual overrides. |
| v4 | 2026-04-13 | multiplierBreadth moved to Ecosystem Alignment. Performance to 42%. signalRatio to 15%. deckReach weight reduced from 50% to 35%. Dimension renamed to Ecosystem Alignment. |
| v5 | 2026-04-13 | Dual casual filter: rank > eligible x 3 for brand tournaments, Top 500 for Abstract. Crypto Creator and Xeet InfoFi exempt (every entry is meaningful). |
| v6 | 2026-04-13 | totalCardsHeld replaces ownCardsHeld (total cards from other creators, not self-cards). Organic XEETS (signal+noise, no bonus) replaces totalXeets in Performance. Confidence multiplier on Performance (1.0x for 8+, 0.9x for 5-7, 0.8x for 3-4, 0.7x for 1-2, 0x for 0 entries). walsxbt #44→#22 Mythic (cards held boost). R2D2zen #9→#30 Legendary (0.8x confidence). |
