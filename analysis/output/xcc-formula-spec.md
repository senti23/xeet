# XCC Creator Scoring Formula — Technical Specification

**Version:** 3.0  
**Date:** 2026-04-13  
**Authors:** Senti, Claude (data agent)  
**Status:** Proposed

---

## 1. Overview

The XCC Creator Score is a composite metric that ranks 391 Xeet Certified Creators across four dimensions of quality: Performance, Engagement, Reach, and Market. The score is designed to surface undervalued creators whose tournament performance the market has not yet priced in.

---

## 2. Notation

| Symbol | Definition |
|--------|-----------|
| $c$ | A creator, $c \in C$ where $\|C\| = 391$ |
| $T_c$ | Set of all tournament entries for creator $c$ |
| $T_c^{comp}$ | Subset of $T_c$ that pass the competitive filter (Section 4) |
| $t$ | A single tournament entry |
| $S(c)$ | Composite score for creator $c$, range [0, 100] |
| $P(c)$ | Performance dimension score |
| $E(c)$ | Engagement dimension score |
| $R(c)$ | Reach/Efficiency dimension score |
| $M(c)$ | Market dimension score |
| $\text{RN}(x)$ | Rank-normalization function (Section 3) |

---

## 3. Rank Normalization

All raw signals are converted to a 0-100 scale using rank-based normalization before weighting. This is robust to outliers and non-normal distributions (most signals are heavily right-skewed).

For a signal vector $\mathbf{x} = (x_1, x_2, \ldots, x_n)$ across all creators with non-null values:

$$\text{RN}(x_i) = \frac{\text{rank}(x_i) - 1}{n - 1} \times 100$$

where $\text{rank}(x_i)$ is the average rank of $x_i$ among non-null values (ties get the mean of their ranks).

- Null values remain null and do not contribute to the weighted sum.
- For inverted signals (lower = better), apply $100 - \text{RN}(x_i)$.

---

## 4. Competitive Entry Filter

Not all tournament entries reflect genuine competition. The filter separates "showed up" from "actually competed."

### 4.1 Exclusions (removed entirely from performance calculations)

| Category | Tournaments | Reason |
|----------|------------|--------|
| Participation events | Xeetsgiving | 3-day event, 100% win rate, zero competitive signal |
| Cancelled | Cryptoys, ADI Drop 2, DataHaven | No rewards distributed |
| Orphan (no difficulty data) | Grimmy, Vault777 | Cannot compute difficulty-adjusted metrics |

XEETS earned in excluded tournaments do NOT count toward `totalXeetsExclXeetsgiving`.

### 4.2 Casual Participation Threshold

For each tournament $j$ with known median XEETS $\tilde{x}_j$:

$$\theta_j = \lceil \tilde{x}_j / 10 \rceil \times 10$$

Examples:

| Tournament | Median XEETS | Threshold $\theta_j$ |
|-----------|-------------|---------------------|
| Blinko | 12 | 20 |
| Cockio | 3 | 10 |
| Solstice | 12 | 20 |
| Myriad | 19 | 20 |
| Abstract | 33 | 40 |
| Crypto Creator | 32 | 40 |

If creator $c$ earned $x_{c,j} < \theta_j$ in tournament $j$:

- The entry is flagged as **casual**
- $x_{c,j}$ still counts toward `totalXeetsExclXeetsgiving` (it's real XEETS earned)
- But the entry is **excluded** from $T_c^{comp}$ and does not feed into any performance sub-signal

### 4.3 Manual Overrides

In rare cases where the threshold fails to capture intent (e.g., a creator earned just above median but only posted twice), manual overrides can force an entry to casual. These are stored in `config.py → MANUAL_CASUAL_OVERRIDES`.

### 4.4 What Passes the Filter

A tournament entry for creator $c$ in tournament $j$ is **competitive** ($\in T_c^{comp}$) if and only if:

1. Tournament $j$ is not Xeetsgiving, cancelled, or orphan
2. $x_{c,j} \geq \theta_j$
3. No manual override exists for $(c, j)$

---

## 5. Composite Score

$$S(c) = 0.40 \cdot P(c) + 0.25 \cdot E(c) + 0.20 \cdot R(c) + 0.15 \cdot M(c)$$

The weights reflect the design thesis: V2 tournaments reward verified outcomes, so past competitive performance (40%) and ecosystem engagement (25%) matter most. Reach efficiency (20%) captures who converts attention into results. Market (15%) is a confirmation signal — does the market agree? — not a core driver (the market's r^2 with performance is only 0.109).

---

## 6. Performance Dimension — $P(c)$

**Weight in composite: 40%**  
**What it measures:** How well does this creator perform in competitive tournaments?

$$P(c) = 0.30 \cdot \text{RN}(\bar{p}_c) + 0.25 \cdot \text{RN}(X_c) + 0.25 \cdot \text{RN}(N_c) + 0.10 \cdot \text{RN}(\bar{s}_c) + 0.10 \cdot \text{RN}(B_c)$$

### 6.1 Average Difficulty-Adjusted Percentile — $\bar{p}_c$

**Effective weight: 12.0%** | Source: `xeet-creators-full.json` tournaments + `tournament-difficulty-data.json`

For each competitive entry $t \in T_c^{comp}$ in tournament $j$:

$$p_{c,j} = 1 - \frac{\text{rank}_{c,j}}{R_j}$$

where $R_j$ is the **real participant count** from `tournament-difficulty-data.json` (NOT the inflated API count from `tournamentSize`).

Then:

$$\bar{p}_c = \frac{1}{|T_c^{comp}|} \sum_{t \in T_c^{comp}} p_{c,j}$$

**IOPn special handling:** The JSON has null realParticipants for the combined IOPn entry. Creator entries are matched to individual drops by `rewardStartDate`:

| Drop | Date Range | $R_j$ | $\tilde{x}_j$ |
|------|-----------|-------|---------------|
| Drop 1 | 2025-10-22 to 2025-11-27 | 4,889 | 14 |
| Drop 2 | 2025-11-27 to 2025-12-27 | 1,229 | 3 |
| Drop 3 | 2025-12-29 to 2026-01-15 | 680 | 5 |

**Why 30% weight (up from 20% in v1):** Quality per tournament matters more than volume. A creator who consistently finishes in the 95th percentile across 5 tournaments is more valuable than one who grinds 15 tournaments at the 80th percentile.

### 6.2 Total XEETS (excl. Xeetsgiving) — $X_c$

**Effective weight: 10.0%** | Source: `xeet-creators-full.json` → `tournaments[].totalPoints`

$$X_c = \sum_{t \in T_c \setminus \{\text{Xeetsgiving, cancelled}\}} x_{c,j}$$

Note: this includes casual entries. It measures total earning power regardless of competitive intent. Cancelled tournament XEETS are also excluded.

**Why 25% weight (down from 35% in v1):** Raw XEETS correlates heavily with tournament count (Spearman r=0.77). Reducing its weight relative to percentile prevents the formula from just ranking by who played the most.

### 6.3 Competitive Tournament Count — $N_c$

**Effective weight: 10.0%** | Source: computed from `xeet-creators-full.json` tournaments

$$N_c = |T_c^{comp}|$$

Only entries passing the competitive filter (Section 4) are counted. This measures consistency and reliability — how many times did this creator show up and actually compete?

### 6.4 Signal Ratio Average — $\bar{s}_c$

**Effective weight: 4.0%** | Source: `xeet-creators-full.json` → `tournaments[].signalPoints`, `totalPoints`

For each competitive entry:

$$s_{c,j} = \frac{\text{signalPoints}_{c,j}}{\text{totalPoints}_{c,j}}$$

$$\bar{s}_c = \frac{1}{|T_c^{comp}|} \sum_{t \in T_c^{comp}} s_{c,j}$$

Signal points represent organic content quality. Noise and bonus points represent engagement gaming and project-specific multipliers. Higher signal ratio = purer content quality.

### 6.5 Multiplier Breadth — $B_c$

**Effective weight: 4.0%** | Source: `xeet-creators-full.json` → `tournaments[].multiplier`

$$B_c = |\{j : \text{multiplier}_{c,j} > 1.0 \text{ and } j \notin \text{PLATFORM}\}|$$

Count of distinct non-platform tournaments where the creator earned a V1 multiplier (by holding the project's NFT, using their product, etc.). Platform tournaments (ct, xeet, abstract) are excluded because their multipliers don't indicate project-specific alignment.

**Why this matters for V2:** A creator who went deep on Blinko (played the game), Myriad (used the DEX), AND IOPn (engaged with infra) shows willingness to understand brands — critical for V2 squad leadership.

---

## 7. Engagement Dimension — $E(c)$

**Weight in composite: 25%**  
**What it measures:** How invested is this creator in the XCC ecosystem?

$$E(c) = 0.50 \cdot \text{RN}(D_c) + 0.30 \cdot \text{RN}(O_c) + 0.20 \cdot \text{RN}(K_c)$$

### 7.1 Deck Reach Score — $D_c$

**Effective weight: 12.5%** | Source: `deck-scores.json` → `wallets[wallet].score`

The deck reach score measures how many of the 391 creators a wallet can access through direct and secondary card holdings. Matched by the creator's `walletAddress`. For multi-wallet creators (8 creators in `multi-wallet-creators.json`), the highest score across all wallets is used.

**Why this is the single highest-weighted signal:** In V2, card holdings determine squad access. A creator who holds cards from 100+ other creators has maximum optionality — they can join nearly any squad. This is the strongest proxy for "will be active in V2."

### 7.2 Own Cards Held — $O_c$

**Effective weight: 7.5%** | Source: `creator-holdings.json` → `holds[]` where `creator == self`

$$O_c = \sum_{\text{wallets}} \text{quantity where creator holds their own cards}$$

Multi-wallet creators: summed across primary + additional wallets from `multi-wallet-creators.json`.

Skin in the game. A creator who holds their own cards signals long-term commitment to the ecosystem rather than dumping supply.

### 7.3 Crypto Creator XEETS — $K_c$

**Effective weight: 5.0%** | Source: `xeet-creators-full.json` → tournament entry where `topicSlug == "crypto-creator"`

$$K_c = x_{c,\text{ct}}$$

The Crypto Creator tournament is a standalone quality signal: 89,655 real participants, 219 days duration, XEETS-only rewards, pure organic content quality. Performance here indicates general creator ability independent of brand incentives or multipliers.

345 of 391 creators participated. Those who didn't get null (handled by rank-normalization).

---

## 8. Reach / Efficiency Dimension — $R(c)$

**Weight in composite: 20%**  
**What it measures:** How efficiently does this creator convert audience into outcomes?

$$R(c) = 0.35 \cdot \text{RN}(F_c) + 0.35 \cdot \text{RN}(\text{XPF}_c) + 0.30 \cdot \text{RN}(V_c)$$

### 8.1 Followers — $F_c$

**Effective weight: 7.0%** | Source: `xeet-creators-full.json` → `followers`

Raw X (Twitter) follower count. Represents audience size — a necessary but not sufficient condition for influence.

### 8.2 XEETS Per Follower (XPF) — $\text{XPF}_c$

**Effective weight: 7.0%** | Source: computed

$$\text{XPF}_c = \frac{X_c}{F_c}$$

where $X_c$ is total XEETS (excl. Xeetsgiving) and $F_c$ is follower count.

This is the key innovation over v1's raw followers. A creator with 2,000 followers and 5,000 XEETS (XPF = 2.5) extracts far more value per follower than one with 100,000 followers and 5,000 XEETS (XPF = 0.05). Small engaged audiences beat large passive ones.

**Why equal weight with followers (35/35):** Pure XPF over-rewards tiny accounts. Balancing with raw followers ensures creators need both efficiency AND reach to score highly.

### 8.3 Niche Diversity — $V_c$

**Effective weight: 6.0%** | Source: computed from `tournament-difficulty-data.json` niche assignments

$$V_c = |\{\text{niche}(j) : t \in T_c^{comp}\}|$$

Count of distinct niches across competitive entries. Niches: Gaming, DeFi, NFT/Art, Infrastructure, Social, Science.

Breadth across niches shows adaptability. A creator who can drive results for a DeFi protocol AND a gaming project is more versatile as a V2 squad member than one who only knows one vertical.

---

## 9. Market Dimension — $M(c)$

**Weight in composite: 15%**  
**What it measures:** Does the market agree this creator is valuable?

$$M(c) = 0.25 \cdot \text{RN}(L_c) + 0.25 \cdot \text{RN}(W_c) + 0.20 \cdot \text{RN}(H_c) + 0.15 \cdot \text{RN}(\Delta_c) + 0.15 \cdot \text{RN}(Z_c)$$

**Why only 15% (down from 25% in v1):** The market-performance correlation is r^2 = 0.109. The market explains only 11% of performance variance — it prices primarily on name recognition and card rarity, not tournament results. We deliberately underweight market to surface the gap between performance and price. That gap IS the alpha opportunity.

### 9.1 OpenSea Floor Price (Common) — $L_c$

**Effective weight: 3.75%** | Source: `web/public/data/floor-prices.json` → `prices[handle].common.osFloor`

Current floor price in ETH for the common rarity on OpenSea. 11 of 391 creators have null (no active listings).

### 9.2 ETH Sale Volume — $W_c$

**Effective weight: 3.75%** | Source: `xeet.db` → `sale_history`

$$W_c = \sum_{\text{sales where currency} \in \{\text{ETH, WETH}\}} \text{price}$$

Total historical ETH trading volume. WETH is normalized to ETH. XEETS-denominated sales (3,166 of 16,467 total) are excluded — different currency, cannot be summed.

### 9.3 Highest Sale Price (Common) — $H_c$

**Effective weight: 3.0%** | Source: `xeet.db` → `sale_history`

$$H_c = \max(\text{price} : \text{rarity} = \text{common}, \text{currency} \in \{\text{ETH, WETH}\})$$

Peak demand signal — what was the maximum someone paid for this creator's common card?

### 9.4 Price Trajectory — $\Delta_c$

**Effective weight: 2.25%** | Source: `xeet.db` → `sale_history` (last 10 OpenSea sales)

Linear regression slope of price over time for the most recent 10 ETH/WETH sales, with time normalized to [0, 1]:

$$\Delta_c = \beta_1 \text{ from } \text{price} = \beta_0 + \beta_1 \cdot t_{\text{normalized}}$$

Requires minimum 3 data points. Positive = rising price, negative = falling.

### 9.5 Sale Velocity (30 days) — $Z_c$

**Effective weight: 2.25%** | Source: `xeet.db` → `sale_history`

$$Z_c = |\{\text{sales where sold\_at} \geq \text{now} - 30\text{d and currency} \in \{\text{ETH, WETH}\}\}|$$

Recent trading activity. A card that hasn't traded in months has low velocity regardless of floor price.

---

## 10. Tier Assignment

Creators are assigned to 5 tiers based on composite score percentile:

| Tier | Percentile Threshold | Target Size | Score Range (current) |
|------|---------------------|-------------|----------------------|
| Mythic | >= 93.6th | ~25 | 75.1 - 87.5 |
| Legendary | >= 80.8th | ~50 | 66.8 - 75.0 |
| Epic | >= 61.6th | ~75 | 54.5 - 66.7 |
| Rare | >= 33.5th | ~110 | 41.3 - 54.4 |
| Common | < 33.5th | ~131 | 9.1 - 41.2 |

Tier names align with Xeet's card rarity system but represent **performance tiers**, not card rarities. A Common card of a Mythic-tier creator is more valuable than a Legendary card of a Common-tier creator.

---

## 11. Data Sources

| Source | Records | Used For |
|--------|---------|----------|
| `xeet-creators-full.json` | 391 creators | Tournament arrays, followers, cards, walletAddress |
| `tournament-difficulty-data.json` | 33 tournaments | realParticipants (ground truth), medianXeets, niches |
| `tournament-difficulty-table.csv` | 33 rows | IOPn per-drop stats (JSON has nulls for multi-drop) |
| `web/public/data/floor-prices.json` | 391 creators | OS/Xeet floor prices, last sale, best offer |
| `xeet.db → sale_history` | 16,467 sales | ETH volume, highest sale, trajectory, velocity |
| `creator-holdings.json` | 386 creators | Own cards held, total cards held |
| `deck-scores.json` | 3,867 wallets | Deck reach score |
| `multi-wallet-creators.json` | 8 creators | Merge holdings across alt wallets |
| `creators-profiles.json` | 392 creators | xeetBalance (reference only) |

### Critical Data Rules

1. **realParticipants** must come from `tournament-difficulty-data.json`, NOT from the API's `meta.total` or `tournamentSize` in the enriched JSON — those are inflated with zero-earners.
2. **ETH and WETH** are the same denomination and always combined. **XEETS** is a separate currency and never mixed with ETH.
3. **ERC-1155 purchase matching** uses `tx_hash`, not `buyer` address (buyer can be a proxy/conduit contract).

---

## 12. Effective Weight Summary

Sorted by impact on the composite score:

| Rank | Signal | Dimension | Effective Weight |
|------|--------|-----------|-----------------|
| 1 | deckReachScore | Engagement | 12.50% |
| 2 | avgDifficultyAdjustedPercentile | Performance | 12.00% |
| 3 | totalXeetsExclXeetsgiving | Performance | 10.00% |
| 4 | competitiveTournamentCount | Performance | 10.00% |
| 5 | ownCardsHeld | Engagement | 7.50% |
| 6 | followers | Reach | 7.00% |
| 7 | XPF (XEETS/followers) | Reach | 7.00% |
| 8 | nicheDiversity | Reach | 6.00% |
| 9 | cryptoCreatorXeets | Engagement | 5.00% |
| 10 | signalRatioAvg | Performance | 4.00% |
| 11 | multiplierBreadth | Performance | 4.00% |
| 12 | osFloorCommon | Market | 3.75% |
| 13 | ethSaleVolume | Market | 3.75% |
| 14 | highestSaleCommon | Market | 3.00% |
| 15 | priceTrajectory | Market | 2.25% |
| 16 | saleVelocity30d | Market | 2.25% |
| | **TOTAL** | | **100.00%** |

---

## 13. Version History

| Version | Date | Changes |
|---------|------|---------|
| v1 | 2026-04-13 | Initial formula. Market 25%, Performance 40%, Engagement 20%, Reach 15%. Followers as raw signal. cryptoCreatorXeets in both Engagement and overlapping with Performance. |
| v2 | 2026-04-13 | Market reduced to 15%. Followers replaced with XPF. cryptoCreatorXeets deduplicated (Engagement only). avgPercentile weight boosted to 30%. 5 tiers (was 3 clusters). |
| v3 | 2026-04-13 | XPF balanced with followers (35/35 split + 30% nicheDiversity). Casual filter manual overrides added. |

---

## 14. Limitations and Future Work

1. **No engagement rate data.** Follower count without likes/retweets/impressions is an imperfect proxy for reach. Twitter API access would enable engagement-adjusted reach.
2. **V1 performance may not predict V2.** V2 uses verified-outcome KPIs, not content posting. Squad leadership, coordination, and brand understanding are not captured by V1 data.
3. **Static snapshot.** Floor prices, sales, and holder data are point-in-time. The formula should be re-run periodically as new data arrives.
4. **Casual filter is heuristic.** The median-rounded-up threshold catches ~90% of casual entries but misses borderline cases. Manual overrides address known exceptions.
5. **No burn/craft mechanics yet.** V2 may introduce card burning or crafting that changes supply dynamics. The formula does not account for this.
