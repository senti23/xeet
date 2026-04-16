# Deck Strength Score — Methodology

## What it measures

Deck Strength is a single number that captures how strong your Xeet Creator Card collection is. It combines two dimensions:

1. **Creator quality** — which creators' cards you hold (their XCC tier, determined by the Xeet Co-Efficient composite score).
2. **Card scarcity** — what rarity of cards you hold (legendary, rare, or common — determined by on-chain supply).

The formula rewards both breadth (holding many creators) and depth (holding rare cards of high-tier creators).

---

## Formula

```
Deck Strength = Σ  tier_weight × rarity_weight × quantity
              (over every card in your direct holdings)
```

Each card you hold contributes `tier_weight × rarity_weight` points, multiplied by how many copies you own.

### Creator Tier Weights

These come from the XCC tier system. Tiers are assigned based on the creator's composite score across four dimensions: Performance, Market, Ecosystem, and Reach.

| Tier | Weight | Creators |
|------|--------|----------|
| Mythic | ×5 | 25 |
| Legendary | ×3 | 50 |
| Epic | ×2 | 75 |
| Rare | ×1 | 110 |
| Common | ×0.5 | 131 |

Total: 391 XCC creators.

### Card Rarity Weights

Card rarity is an on-chain attribute of the NFT itself — it reflects supply scarcity. The multipliers are conservatively dampened from actual supply ratios:

| Rarity | Weight | Median supply per creator | Actual scarcity vs common |
|--------|--------|--------------------------|---------------------------|
| Legendary | ×5 | ~1 copy | ~70× rarer |
| Rare | ×2 | ~13 copies | ~5× rarer |
| Common | ×1 | ~70 copies | baseline |

**Why dampened?** Raw inverse-supply would give legendary a 70× multiplier, which would make the entire leaderboard about "who has the most legendaries" and flatten the creator-tier signal. We use approximately the square root of the actual supply ratios (√70 ≈ 8, √5 ≈ 2), rounded conservatively to 5/2/1. This keeps both dimensions meaningfully in play — a Mythic creator's common card (5 × 1 = 5 pts) is still worth more than a Common creator's rare card (0.5 × 2 = 1 pt).

Note: only ~194 of 391 creators have a legendary card in circulation. Most legendaries have a supply of exactly 1. The scarcity is real but the data is limited — we don't have full provenance or pricing context on every rarity level, so we deliberately err on the conservative side. This may be refined as more market data becomes available.

---

## Worked examples

### A focused legendary hunter
| Card | Tier | Rarity | Qty | Points |
|------|------|--------|-----|--------|
| Mythic creator (legendary card) | ×5 | ×5 | 1 | 25.0 |
| Legendary creator (rare card) | ×3 | ×2 | 2 | 12.0 |
| Common creator (common card) | ×0.5 | ×1 | 10 | 5.0 |
| **Total** | | | **13** | **42.0** |

### A volume collector
| Card | Tier | Rarity | Qty | Points |
|------|------|--------|-----|--------|
| Epic creator (common card) | ×2 | ×1 | 50 | 100.0 |
| Rare creator (common card) | ×1 | ×1 | 100 | 100.0 |
| **Total** | | | **150** | **200.0** |

Both strategies score — but the mix matters.

---

## Wallet categories (buckets)

Wallets are grouped by total cards held:

| Category | Cards held |
|----------|-----------|
| Small | 0–30 |
| Medium | 31–80 |
| Large | 81–150 |
| Whale | 151+ |

Within each bucket, wallets are ranked by Deck Strength. Your "bucket rank" tells you how you stack up against similarly-sized collectors.

---

## What Deck Strength is NOT

- **Not a reach score.** The /reach page measures network coverage — how many of the 391 creators you can access through direct + secondary holdings. That's a graph-traversal metric. Deck Strength doesn't care about network reach; it cares about card quality.
- **Not a market valuation.** Floor prices, ETH volume, and trade history are separate from Deck Strength. A high-strength deck isn't necessarily the most expensive one (though there's correlation).
- **Not static.** Your Deck Strength changes as you acquire or sell cards. The on-chain holder snapshot refreshes every 10 minutes, so scores update in near-real-time.

---

## Data sources

| Input | Source | Refresh |
|-------|--------|---------|
| Holder snapshot (who holds what) | Abstract chain via ABScan | Every 10 min |
| Creator tiers (XCC composite scores) | Xeet Co-Efficient formula v6 | Manual update |
| Card rarity (legendary / rare / common) | On-chain NFT attributes | Static per token |
| Supply counts | Derived from holder snapshot | Every 10 min |

---

*Last updated: April 2025. Weights may be adjusted as more market and rarity data becomes available.*
