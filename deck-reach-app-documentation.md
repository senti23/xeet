# DECK REACH APP — CODEBASE & FEATURE DOCUMENTATION
## Last updated: 2026-03-31

> **Purpose**: Technical reference for any agent working on the Deck Reach app. Covers architecture, data pipelines, features built, features planned, and deployment.

---

## 1. PROJECT OVERVIEW

The Deck Reach App is a market intelligence and analytics platform for Xeet Creator Cards (XCC) — an ERC-1155 NFT trading card game on the Abstract blockchain. It helps holders understand their deck's reach, find missing creators, and identify the best cards to buy.

**Live URLs:**
- Frontend: Vercel (xeet-deck-reach-score.vercel.app)
- Backend: Railway (persistent Fastify server + SQLite)

**Key user:** Senti (@Senti__23), wallet `0xc065666a1c3a05b81e8e36009332253c73dc769b`

---

## 2. ARCHITECTURE

### 2.1 Monorepo Structure

```
xeet/                                # GitHub: senti23/xeet
├── server/                          # Fastify + SQLite + data pipeline
│   ├── src/
│   │   ├── index.ts                 # Server entry, CORS, pipeline start, refresh cron
│   │   ├── config.ts                # Env vars, paths, intervals
│   │   ├── collector.ts             # Standalone sales collector (alternative entry)
│   │   ├── services/
│   │   │   ├── data-pipeline.ts     # 60s polling cycle, floor price cache, sale history
│   │   │   ├── deck-refresh.ts      # 10-min unified refresh (holders → scores → prices)
│   │   │   ├── deck-missing.ts      # Missing creators + bridge suggestions + price enrichment
│   │   │   ├── holder-service.ts    # Abscan ERC-1155 transfer tracking, wallet holdings
│   │   │   ├── xeet-client.ts       # Xeet MP API client (listings, activity, card history)
│   │   │   ├── opensea-client.ts    # OpenSea API client (listings, sales, offers, stats)
│   │   │   ├── opensea-stream.ts    # OpenSea WebSocket for real-time listing events
│   │   │   ├── token-map.ts         # tokenId ↔ creator handle + rarity mapping
│   │   │   └── price-service.ts     # ETH/USD rate fetching
│   │   ├── api/
│   │   │   ├── deck.ts              # /api/deck/* routes (missing, status, refresh, scores)
│   │   │   ├── listings.ts          # /api/listings (floor prices, marketplace data)
│   │   │   ├── sales.ts             # /api/sales (sale history, volume)
│   │   │   ├── holders.ts           # /api/deck/:wallet, /api/whales, /api/holders/:tokenId
│   │   │   └── routes.ts            # Route registration
│   │   ├── db/
│   │   │   ├── index.ts             # SQLite init, migrations, prepared statements
│   │   │   └── schema.ts            # Table schemas + prepared statement definitions
│   │   └── lib/
│   │       ├── rate-limiter.ts      # Adaptive rate limiter
│   │       ├── retry.ts             # Retry with exponential backoff
│   │       └── logger.ts            # Pino logger
│   ├── scripts/
│   │   ├── compute-deck-scores.ts   # Pre-compute reach for all wallets (importable function)
│   │   ├── download-avatars.ts      # Download 392 pfps to web/public/avatars/
│   │   ├── test-missing.ts          # Test missing creators computation
│   │   └── verify-dataset.ts        # Data completeness verification
│   ├── data/                        # JSON data files for Railway deploy
│   │   ├── xeet-creators-full.json
│   │   ├── creator-holdings.json
│   │   ├── multi-wallet-creators.json
│   │   └── creators-profiles.json
│   ├── railway.json                 # Railway deploy config
│   └── package.json
│
├── web/                             # Next.js 15 + React 19 + Tailwind 4
│   ├── src/
│   │   ├── app/
│   │   │   ├── deck/page.tsx        # Deck reach page (server component, metadata)
│   │   │   └── globals.css          # Theme vars, fonts
│   │   ├── components/deck/
│   │   │   ├── DeckPageClient.tsx    # Main orchestrator — layout, state, data loading
│   │   │   ├── DeckScoreCard.tsx     # Score display (reach %, direct/secondary, ranks)
│   │   │   ├── DeckGraph.tsx         # Force-directed graph visualization (canvas + d3-force)
│   │   │   ├── DeckLeaderboard.tsx   # Ranked wallet leaderboard (XCC / All tabs)
│   │   │   ├── DeckMissingPanel.tsx  # Missing creators with best picks + remaining options
│   │   │   ├── DeckHoldingsPanel.tsx # Holdings table with activity + rarity + bridges
│   │   │   └── CollapsiblePanel.tsx  # Reusable expand/collapse panel
│   │   ├── lib/
│   │   │   └── api.ts               # API_BASE helper (NEXT_PUBLIC_API_URL)
│   │   └── types/
│   │       └── deck.ts              # TypeScript types for deck data
│   ├── public/
│   │   ├── data/                    # Generated JSON files (static fallback for Vercel)
│   │   │   ├── deck-scores.json
│   │   │   ├── deck-scores-detail.json
│   │   │   ├── floor-prices.json
│   │   │   └── creator-holdings.json
│   │   └── avatars/                 # ~392 creator pfp images
│   └── package.json
│
├── xeet-creators-full.json          # Canonical creator dataset (repo root)
├── creators-profiles.json           # Avatar URLs + balances
├── multi-wallet-creators.json       # 8 creators with alt wallets
├── holder-snapshot.json             # On-chain holder data
├── creator-holdings.json            # XCC cross-holdings
└── .env                             # API keys (gitignored)
```

### 2.2 Data Flow

```
┌─────────────────────────────────────────────────┐
│                DATA PIPELINE (60s cycle)         │
│                                                  │
│  Xeet MP ──→ listings + activity ──→ xeetFloor  │
│  OpenSea ──→ listings + offers ──→ osFloor      │
│  OpenSea ──→ sale events ──→ sale_history (DB)  │
│  Xeet ────→ activity (SALE) ──→ sale_history    │
│                                                  │
│  All ──→ PipelineCache (in-memory Map)          │
│         key: "creator:rarity"                    │
│         val: floors, listings, lastSale, offers  │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│           DECK REFRESH (10-min cycle)            │
│                                                  │
│  Abscan ──→ new ERC-1155 transfers ──→ holders  │
│  Holders ──→ compute deck scores (all wallets)  │
│  Scores ──→ deck-scores.json + detail.json      │
│  Cache ──→ floor-prices.json                     │
│                                                  │
│  In prod: serve via API from memory              │
│  In dev: write to web/public/data/               │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────┐
│              FRONTEND (Next.js)                  │
│                                                  │
│  Loads scores from API (fallback: static JSON)  │
│  Wallet search → score card + graph + panels    │
│  Missing panel → GET /api/deck/missing?wallet=  │
│  Leaderboard → clickable, loads any wallet      │
└─────────────────────────────────────────────────┘
```

### 2.3 Database (SQLite: xeet.db)

**Tables:**
- `sale_history` — all marketplace sales (Xeet MP + OpenSea). 2,975 + 12,214 rows.
- `token_map` — tokenId → creator handle + rarity mapping
- `card_holders` — current on-chain balances per wallet per token
- `pipeline_meta` — backfill completion flags, last synced block
- `sync_meta` — holder sync timestamps
- `telegram_*` — bot tables (not actively used)

**Key queries:**
- `getAllHolders` — all card_holders rows with quantity > 0 (~29,000 rows)
- `getHoldersByWallet` — per-wallet holdings
- `getLastSaleByCreatorRarity` — most recent sale for pricing
- `upsertSale` — INSERT OR IGNORE for dedup

---

## 3. FEATURES — BUILT & WORKING

### 3.1 Deck Reach Score

**What:** Paste any wallet address → see how many of the 391 XCC creators you can "reach" through direct holdings and secondary access via XCC cross-holdings.

**How reach works:**
- Direct: you hold Creator A's card = direct reach to A
- Secondary: Creator A holds Creator B's card = you have secondary reach to B through A
- Total reach = direct + secondary (deduplicated)

**Computation:** `computeAllDeckScores()` in compute-deck-scores.ts scores all ~3,868 wallets. Outputs slim scores + full detail with direct/secondary maps. Refreshes every 10 minutes.

**Frontend:** Score card showing reach %, direct/secondary counts, overall rank, XCC rank.

### 3.2 Force-Directed Graph Visualization

**What:** Canvas-based graph showing the wallet holder at center with direct holdings orbiting around, connected by rarity-colored lines.

**Tech:** d3-force simulation, canvas rendering, ResizeObserver, pfp circle-clipping from local /avatars/ files.

**Interaction:** Click a direct node → secondary nodes burst outward showing who that card bridges to. Click empty space → reset. Hover → tooltip with creator name, rarity, bridge count.

**Rarity colors:** Common #888780 (grey), Rare #378ADD (blue), Legendary #D85A30 (orange/coral). Connector intensity scales with rarity.

### 3.3 Missing Creators Panel

**What:** Shows which creators you can't reach and the best cards to buy to fix it.

**Two-section layout:**
1. **Best Picks** — top 3 XCC bridge cards ranked by coverage (greedy set cover). Shows: XCC name, cheapest price across both marketplaces, which missing creators each covers.
2. **Remaining** — creators not covered by best picks, each clickable to expand and see their top 5 cheapest bridge options.

**API:** `GET /api/deck/missing?wallet=0x...` returns both `bestPicks` and `remaining` views. Bridge suggestions enriched with live floor prices from pipeline cache. Includes `holdersAsOf` and `pricesAsOf` timestamps.

**Bug fixed:** The bridge suggestions were incorrectly suggesting buying a missing creator's own card (direct access) instead of XCC bridge cards (secondary access). Fixed by excluding self-coverage in xccCoverage building.

**Links:** Each price has marketplace links — OpenSea links use tokenId (`opensea.io/assets/abstract/{contract}/{tokenId}`), Xeet MP links go to generic marketplace page.

### 3.4 Leaderboard

**What:** Ranked list of all wallets by deck reach score. Two tabs: XCC Creators / All Holders.

**Interaction:** Clicking any entry loads that wallet's full data (graph + score + panels). Current wallet highlighted.

**Position:** Right sidebar (~380px) on desktop, toggleable on mobile.

### 3.5 Holdings Panel

**What:** Sortable table of all creators the wallet holds cards from.

**Columns:** Creator (pfp + name), rarity held (colored badges), their activity (cards in their wallet), XEETS earned, bridge count.

**Default sort:** Activity ascending (least active first — dead weight obvious).

### 3.6 Auto-Refresh Pipeline

**What:** Every 10 minutes, automatically:
1. Pull latest ERC-1155 transfers from Abscan (incremental from last synced block)
2. Rebuild holder balances
3. Re-compute deck scores for all wallets
4. Export floor prices from pipeline cache

**Performance:** ~1.9 seconds total (holders ~100ms, scores ~300ms, files ~800ms).

**API:** `GET /api/deck/status` (refresh metadata), `POST /api/deck/refresh` (manual trigger, 5-min rate limit).

### 3.7 Floor Price Pipeline

**What:** Live floor prices per creator per rarity from both Xeet MP and OpenSea.

**Output:** `floor-prices.json` with xeetFloor, osFloor, usdEstimate, listing counts, lastSalePrice, lastSaleMarketplace, lastSaleDate, bestOffer per creator per rarity.

**Coverage:** 386/391 creators with Xeet floors, 167/391 with OS floors.

### 3.8 Multi-Wallet Creator Merging

8 creators identified with alt wallets. Holdings merged during score computation so their reach is correctly calculated.

Creators: Carlitoswa_y, KierianV, Meta_ZET, beijingdou, DjaniWhaleSkul, FogoNPC, BetmanJoe, monitalan (added later).

### 3.9 "Flex Your Deck" Feature

Canvas-based PNG generator that renders the user's rare card artwork with their deck score overlaid. Supports clipboard copy for Twitter sharing. Non-XCC wallets use Xeet's own card (token #27) as the base image.

### 3.10 Credits Section

Top right of the page. "Created by Senti 🪄" with pfp, Abscan wallet link, Twitter link, Xeet profile link. Below: "Inspired by MVC" with pfp, site link, Twitter link, Xeet profile link. Calligraphic font.

### 3.11 Mobile Responsive Leaderboard

On screens below 1024px, the leaderboard is hidden by default with a toggle button. Desktop layout unchanged.

---

## 4. FRONTEND LAYOUT

### 4.1 Page Structure

```
DEFAULT VIEW:
┌──────────────────────────────────────────────┬─────────────────┐
│  [Wallet Input]                [Updated X ago]│                 │
│                                               │                 │
│  Score Card        [Flex] [Analytics]          │  Leaderboard    │
│                                               │  (right sidebar │
│              Force-directed Graph             │   ~380px)       │
│              (fills main area)                │                 │
│                                               │                 │
└──────────────────────────────────────────────┴─────────────────┘

ANALYTICS VIEW (toggle):
┌──────────────────────────────────────────────┬─────────────────┐
│  Score Card        [Flex] [← Back to Graph]   │  Leaderboard    │
│                                               │                 │
│  ▾ Missing · 5                                │                 │
│    Best Picks + Remaining                     │                 │
│  ▸ Holdings · 111                             │                 │
│  ▸ Squad Access (coming soon)                 │                 │
│                                               │                 │
│  [Graph hidden via display:none]              │                 │
└──────────────────────────────────────────────┴─────────────────┘
```

### 4.2 Key UX Decisions
- Graph hidden via `display:none` (not unmounted) to preserve D3 state
- Only one analytics panel open at a time
- Clicking a leaderboard entry resets to graph view
- Missing panel lazy-loads from API on first expand
- Desktop-first, Xeet brand colors (red/white/black)
- Mobile: leaderboard hidden by default with toggle button

### 4.3 Brand Colors
- Background: #0a0a0a
- Accent: #E53935 (Xeet red)
- Text primary: #ffffff, secondary: #888780
- Rarity: common #888780, rare #378ADD, legendary #D85A30

---

## 5. DEPLOYMENT

### 5.1 Frontend (Vercel)
- Deploys from `web/` directory
- Static fallback data in `web/public/data/` and `web/public/avatars/`
- Env var: `NEXT_PUBLIC_API_URL` pointing to Railway backend
- Falls back to static JSON files if API unavailable

### 5.2 Backend (Railway)
- Deploys from `server/` directory
- **No persistent volume on free tier** — SQLite rebuilds from scratch on each deploy. DB_PATH=/tmp/xeet.db
- Railway auto-injects `PORT=8080` — domain mapped to 8080, not 3001. This caused a deployment issue initially.
- Env vars: `OPENSEA_API_KEY`, `ABSCAN_API_KEY`, `NODE_ENV=production`, `FRONTEND_URL`, `DB_PATH=/tmp/xeet.db`, `DATA_DIR`
- Runs 24/7: pipeline polling (60s), deck refresh (10min), WebSocket stream
- Upgrade to Railway developer plan ($5/month) needed for sustained 24/7 uptime

### 5.3 Environment Variables

| Variable | Where | Required | Description |
|----------|-------|----------|-------------|
| OPENSEA_API_KEY | Railway | Yes | OpenSea API key |
| ABSCAN_API_KEY | Railway | No | Abscan for on-chain queries |
| DB_PATH | Railway | Yes | SQLite file path (/tmp/xeet.db on free tier) |
| DATA_DIR | Railway | Yes | Path to JSON data files |
| NODE_ENV | Railway | Yes | `production` |
| FRONTEND_URL | Railway | Yes | Vercel URL for CORS |
| PORT | Railway | No | Auto-injected as 8080 by Railway |
| NEXT_PUBLIC_API_URL | Vercel | Yes | Railway backend URL |

---

## 6. FEATURES — PLANNED / IN PROGRESS

### 6.1 Pending Modifications (queued)
- [ ] Marketplace listing links improvements (Xeet MP card-specific URLs if pattern discovered)

### 6.1b Architecture Notes
- **Deck refresh derives creatorHoldings live** — the refresh pipeline now builds creatorHoldings from the live holderSnapshot by matching XCC wallets, rather than reading the static creator-holdings.json file. This was a critical bug fix: static file meant new purchases weren't reflected in bridge suggestions until manual re-export.
- **Floor price enrichment** — `enrichWithPrices()` finds cheapest xeetFloor and cheapest osFloor independently across rarities. XEETS vs ETH are not compared (apples to oranges). If a marketplace has zero listings across all rarities, that price shows as null.
- **Token map deep links** — `getTokenIdsByCreatorRarity(handle, rarity)` in token-map.ts provides tokenIds for building OpenSea deep links in the missing panel.

### 6.2 Budget Projection / Shopping List (HELD)
- "Given $X budget, which cards maximize your reach gain?"
- Greedy set cover with prices — algorithm straightforward
- **Held pending:** stress testing data accuracy before recommending purchases
- **Needs:** OS sales backfill complete (done), WETH offer extraction fix (partial — 500/1,173 tokens show offers)

### 6.3 Squad Access Leaderboard (placeholder panel exists)
- Which cards give the best reach per dollar spent across the entire ecosystem
- Different from missing panel (which is wallet-specific)
- Needs: ecosystem-wide bridge rankings (not just for your missing creators)
- Held until V2 tournaments launch

### 6.4 Visual Polish Pass (planned)
- Hearthstone-inspired card physicality for holdings/missing panels
- Cards as objects with depth, hover tilt, rarity glow
- Dark textured surface background
- Xeet brand (red/black) meets TCG aesthetic
- Separate pass AFTER layout and data flow confirmed working

### 6.5 FMV / Upgrade Advisor (planned)
- Multi-signal fair market value formula: avg XEETS yield, signal ratio, consistency score, bonus dependency penalty, scarcity multiplier, demand multiplier
- Calibrate against known historical sale prices
- Power an underpriced-card screener
- Needs: clean tournament performance data, reliable floor prices

### 6.6 "Squad Game" Visual Content Series (prototyped)
- D3/canvas-based animated squad tree visualization
- Framework proven: single winning squad, vertical layout, dark/neon aesthetic, real creator pfps, signal ratio arcs, rarity badges, holder counts
- Needs real data + base64 pfps to be content-ready
- Senti prefers covering the meta/game theory angle

### 6.7 WETH Offer Extraction Fix
- `extractEthPrice()` in opensea-client.ts was returning 0 for offers because OpenSea returns `price: {}` for offers
- Partial fix: added fallback to Seaport `offer[0].startAmount`. 500/1,173 tokens now show offers
- Collection-wide best offer: 0.159 WETH
- Full fix needs proper Seaport order parsing

### 6.8 Card Supply Refresh
- `cards.*` fields in xeet-creators-full.json are ~2 months stale
- Supply and holder counts have changed since original data pull
- Not blocking current features but affects accuracy of scarcity analysis

---

## 7. KEY DATA FILES REFERENCE

| File | Location | What it contains | Refreshes |
|------|----------|-----------------|-----------|
| xeet-creators-full.json | repo root + server/data/ | 391 creators, all metadata | Manual (stale on supply) |
| creators-profiles.json | repo root + server/data/ | Avatar URLs + XEETS balances | Manual |
| holder-snapshot.json | repo root | All wallet holdings | Every 10 min (via pipeline) |
| creator-holdings.json | repo root + web/public/data/ | XCC cross-holdings | Every 10 min |
| multi-wallet-creators.json | repo root + server/data/ | 8 alt wallet mappings | Manual |
| deck-scores.json | web/public/data/ | Slim scores for all wallets | Every 10 min |
| deck-scores-detail.json | web/public/data/ | Full detail with direct/secondary | Every 10 min |
| floor-prices.json | web/public/data/ | Floor prices per creator per rarity | Every 10 min |
| xeet.db | gitignored | SQLite: sales, holders, tokens | Continuous (60s cycle) |

---

## 8. CODING PATTERNS & CONVENTIONS

### Agent prompt patterns
- Sequential stages with STOP gates — report results before proceeding
- Data flow first, visual polish second
- Each stage independently testable
- Backend verified before frontend
- One feature per prompt, not multiple

### Data patterns
- Always normalize handles to lowercase before cross-referencing
- Signal ratio / bonus dependency computed on the fly from tournament arrays (not pre-stored)
- `computeAllDeckScores()` accepts data objects, not file paths (importable, testable)
- Bridge suggestions use greedy set cover — sort XCCs by coverage count descending

### Frontend patterns
- `API_BASE` from `NEXT_PUBLIC_API_URL` env var, defaults to `http://localhost:3001`
- API-first data loading with static file fallback
- Graph component NEVER modified — layout changes happen in container
- Graph hidden via `display:none`, not conditional rendering
- Only one collapsible panel open at a time
- Lazy load panel data on first expand
- OpenSea deep links: `opensea.io/assets/abstract/{contract}/{tokenId}` — get tokenId via `getTokenIdsByCreatorRarity(handle, rarity)` in token-map.ts

### Backend patterns
- Pipeline cache is in-memory Map, exported via `getCache()`
- Deck scores cached in module-level variables, exported via getters
- In production: data served via API from memory, not written to disk
- In development: data written to web/public/data/ for hot reload
- 5-min rate limit on manual refresh endpoint
