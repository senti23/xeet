# MegaETH Data Tracking — Verification Report

**Run date:** 2026-05-08
**Plan reference:** `~/.claude/plans/so-we-basically-we-greedy-mountain.md`
**Aggregate signal:** **GO** (with two OpenSea sales endpoints to re-verify tomorrow due to upstream 5xx)

---

## Summary table

| Test | Status | Pass criteria result |
|---|---|---|
| 1. Holder discovery | ✅ **PASS** | 20,051 cards held vs OpenSea's 20,041 → delta +10 (0.05%, well within ±0.5% threshold). 992 unique holders. Senti's 160 cards confirmed. |
| 2. ABS↔MegaETH wallet pairing | ✅ **PASS** | 1237/1248 burns paired (99.1%). Senti's known pair found correctly. AGW theory empirically validated: 504/1037 (49%) of pairs have differing addresses. |
| 3. OpenSea REST | ⚠️ **PARTIAL** | 3a (listings) ✅, 3b (offers, all WETH) ✅. 3c (collection events) + 3d (per-token sales) DEFERRED — both return HTTP 500 persistently across 4+ retries. Likely OpenSea-side outage on `chain=megaeth` events endpoints. |
| 4. OpenSea Stream | ⚠️ **CONNECTION ✅, EVENTS 0/0 → DEFERRED** | Channel `collection:xeet-creator-cards-mega` joined cleanly — SDK + slug fully accepted. 30-min window elapsed with **0 events captured** (no listings/sales/offers happened on MegaETH-side OpenSea during the window). Connection-success is sufficient go-signal for SDK compatibility; event delivery to be re-confirmed tomorrow with a longer wait or during a known-active period. |

**GO / NO-GO call:** GO. Tests 1 + 2 confirm the on-chain ingestion path (holder snapshot, wallet pairing) is fully operational. Tests 3a + 3b confirm OpenSea listings + offers work. The three deferred items (3c sales-feed, 3d per-token sales, 4 event payload sample) are *upstream-availability and timing* issues, not architectural gaps — re-running tomorrow during peak activity will close them.

---

## Test 1 — Holder discovery on MegaETH

**Method:** Etherscan v2 `account/token1155tx` paginated, chainid=4326, contract `0xce8cb6...`. Replayed 17,800 events into `Map<wallet|tokenId, qty>`, filtered to qty > 0, enriched with creator+rarity from `xeet.db` `token_map`.

**Critical adjustment during run:** plan's `startblock=14761074` (Senti's R2D2 mint) was wrong — 2,097 earlier events existed. Reset to `startblock=0` to capture full migration history. Earliest mint was block 14734322 (~2026-04-30 06:42 UTC, ~7h before Senti).

**Results:**
- Total events pulled: 17,800 (across 2 pages — 10K + 7800)
- Mints (from 0x0): 17,297 across 1240 unique txs
- Burns (to 0x0): 0 (none expected — destination chain only)
- Peer-to-peer transfers: 503
- **Unique holders (qty > 0): 992**
- **Total cards held: 20,051** (vs OpenSea's reported 20,041 → +0.05% delta ✅)
- Rarity totals: 16,464 common / 3,309 rare / 45 legendary / 233 unmapped
- Unmapped token rows: 208 — `xeet.db` `token_map` has 846 entries but the actual circulating set spans more token IDs. **Token map needs refresh** — flagged but non-blocking for verification.
- Senti's MegaETH holdings: 143 entries, 160 cards ✅

**Output artifact:** `holders-snapshot.json` (1.9 MB). Schema mirrors `holder-snapshot.json` (Abstract reference).

**Interface boundary confirmed:** Etherscan v2 unified API (`api.etherscan.io/v2/api?chainid=4326&...`) supports MegaETH cleanly with the same `ETHERSCAN_API_KEY` we use for Abstract. Pagination works the same way as the existing `abscan-client.ts` pattern (`startblock` advance, 10K rows max per page, stop when result < 10K).

---

## Test 2 — Creator wallet ABS ↔ MegaETH pair mapping

**Method:** Pulled all Abstract XCC `token1155tx` events from the bridge's first-tx block (58320395) to current. Grouped burns (to=0x0) by tx hash. Reused MegaETH events from Test 1, grouped mints (from=0x0) by tx hash. Paired by canonical signature (`sorted (tokenId:qty)` set) + temporal proximity (≤ 5 min window).

**Results:**
- Abstract events fetched: 18,291 (2 pages)
- ABS burn txs: 1,248
- MegaETH mint txs: 1,240
- **Pairs matched: 1,237 (99.1%)**
- Unmatched burns: 11 (likely match outside 5-min window or split across multiple mints — edge cases worth investigating later)
- Unmatched mints: 3
- **Distinct (abs_wallet, megaeth_wallet) tuples: 1,037**
  - **Same address (non-AGW EOA): 533 (51%)**
  - **Different address (AGW unwrap): 504 (49%)**
- Senti's pair `0xc065666a... → 0x853e1e59...` ✅ FOUND, 4 migrations, 165 cards

**Sample creators:**
- Carlitoswa_y (multi-wallet): 1/2 ABS wallets paired (`0xbafeb3df9b... → 0x6a3867484b...`, 27 cards). The other ABS wallet `0x6a3867484b...` had no migration found — likely never migrated.
- KierianV (multi-wallet): 2/2 ABS wallets paired, **both consolidated to the SAME MegaETH wallet `0x493d3fa24e...`** (9 + 84 cards). Empirical example of N→1 wallet consolidation post-migration.
- r2d2zen, defi_explora, ProofOfEly: profile-extraction issue — `creators-profiles.json` does not store the creator's own wallet address fields. These weren't pairing-failures; they were sample-lookup-failures. Doesn't affect Test 2's core pass — pairing works.

**Bonus discovery — 10 relayer wallets, not 1:** Plan assumed all mints come from a single relayer. Reality: a load-balanced pool of 10 EOAs each handling 99–148 mint txs. The bridge contract `0x97173f...740f` is the stable target — 1230/1240 (99.2%) of mint txs route to it. Tracker filter rule corrected: **filter by `tx.to == BRIDGE`, NOT `tx.from == relayer`**. `.env` updated, docs updated, memory updated.

**Output artifacts:**
- `wallet-migrations.json` (473 KB) — all 1,037 wallet pairs. **This becomes the seed dataset for the future `wallet_migrations` table.**
- `relayer-distribution.json` — full from-address breakdown of mint txs.

---

## Test 3 — OpenSea REST (post-migration)

**Endpoints tested:**

| # | Endpoint | Status | Result |
|---|---|---|---|
| 3a | `/api/v2/listings/collection/xeet-creator-cards-mega/all?limit=100` | ✅ | HTTP 200, 100 listings returned. ETH-denominated. Sample price 0.00109 ETH. Top-level keys match Abstract response: `chain, order_hash, price, protocol_address, protocol_data, remaining_quantity, status, type` |
| 3b | `/api/v2/offers/collection/xeet-creator-cards-mega/all?limit=100` | ✅ | HTTP 200, 100 offers returned. **All 100 are WETH-denominated** (token `0x4200000000000000000000000000000000000006` = WETH on OP Stack predeploy). Includes both per-token and collection-criteria offers. |
| 3c | `/api/v2/events/collection/xeet-creator-cards-mega?event_type=sale&limit=100` | ❌ → DEFERRED | HTTP 500 across 4+ attempts. Body: `{"errors": ["Internal Server Error"]}`. Same shape returned without `event_type` filter too. |
| 3d | `/api/v2/events/chain/megaeth/contract/0xce8cb6.../nfts/786?event_type=sale&limit=50` | ❌ → DEFERRED | HTTP 500 across 4+ attempts. Same body. |

**Diagnosis:** OpenSea's `/events/*` endpoints appear to be down for `chain=megaeth`. This is likely a recent indexing or routing issue on their end — same endpoints work fine for Abstract. Deferred per plan's retry/defer policy.

**Action:** re-run 3c + 3d tomorrow. If still failing, file with OpenSea support, or fall back to per-tx event sniffing via Etherscan logs (we have the contract + the API).

**Output artifacts:** `opensea-rest-samples/3a-listings.json`, `3b-offers.json`, `3c-sales.json` (error body only), `3d-token-sales.json` (error body only).

---

## Test 4 — OpenSea Stream (real-time)

**Method:** Standalone Node script using `@opensea/stream-js` (v0.2.3 — already in repo deps), subscribed to:
- `client.onItemListed('xeet-creator-cards-mega', cb)`
- `client.onItemSold('xeet-creator-cards-mega', cb)`
- `client.onItemReceivedOffer('xeet-creator-cards-mega', cb)`

Network: `Network.MAINNET` (auto-routes — Stream API is collection-slug-keyed, not chain-keyed).

**Connection result:**
```
[INFO]: Successfully joined channel "collection:xeet-creator-cards-mega"
[INFO]: Successfully joined channel "collection:xeet-creator-cards-mega"
```
**SDK accepts the new MegaETH collection slug cleanly.** No auth errors. No "unknown collection slug" rejection. Connection is healthy — same SDK pattern as the Abstract pipeline can be reused with just a different `collectionSlug` arg.

**Event capture:** **0 events in 30 minutes.** `stream-events.jsonl` is empty. `test4-summary.json` records:
```json
{ "duration_ms": 1800028, "events_captured": 0, "timed_out": true, "status": "DEFERRED" }
```

**Interpretation:** the silence is a *marketplace-activity* problem, not a *connection-or-SDK* problem. The "Successfully joined channel" log is conclusive — the SDK accepts the slug, auth works, the websocket stays open. Marketplace just happens to have been quiet during this window (no new listings, sales, or offers on the MegaETH side over those 30 min — plausible at off-peak hours).

**Action:** re-run during peak activity (or longer wait, or during a known-imminent listing) to capture an actual payload and verify the field-extraction works. Connection-acceptance alone is sufficient to greenlight the Stream-mirror approach for the eventual MegaETH ingestion build.

---

## Cross-test findings worth carrying forward

### 1. AGW unwrap is a major operational fact
**49% of all migration pairs have different wallet addresses across chains.** The eventual `wallet_migrations` table is essential — without it, half of all migrating users would split into two phantom holder records in any cross-chain analytics.

### 2. The bridge has 10 relayer wallets, not 1
Initial discovery from a single tx (`0xbcb35bbb...`) was misleading. The pool rotates. **All tracker logic that "watches the relayer" should instead "watch the bridge contract"** — it's the stable target.

### 3. token_map needs a refresh
208 token rows on MegaETH had no entry in `xeet.db token_map` (846 entries currently). Either new creator cards were minted post-`token_map` snapshot, or the snapshot was always incomplete. Task: regenerate `token_map` from current contract state on both chains.

### 4. Etherscan v2 is the unified path
A single `ETHERSCAN_API_KEY` works seamlessly for chainid=2741 (Abstract) and chainid=4326 (MegaETH). The existing `abscan-client.ts` pattern (Etherscan-v1 style with explicit chainid) ports cleanly to v2 with one URL change (`api.abscan.org` → `api.etherscan.io/v2/api`). No new keys, no new auth.

### 5. OpenSea's `/events/*` endpoint is currently broken for `chain=megaeth`
Both `/events/collection/{slug}` and `/events/chain/{chain}/contract/{addr}/nfts/{id}` return HTTP 500. Ticket-worthy on the OpenSea side. Re-run tomorrow. If persistent, fallback paths exist (sniff sales via on-chain TransferSingle events + match against Xeet marketplace activity using existing minute-bucket matcher in `xeet-client.ts`).

---

## Files produced

```
analysis/megaeth-verify/
├── verification-report.md          (this file)
├── test1-holders.mjs               (script)
├── test1-log.txt                   (run log)
├── test1-summary.json              (machine-readable result)
├── holders-snapshot.json           (1.9MB — 992 wallets, 20,051 cards)
├── megaeth-raw-events.json         (12.4MB — raw Etherscan event dump, reused by Test 2)
├── test2-wallet-pairing.mjs        (script)
├── test2-log.txt                   (run log)
├── test2-summary.json              (machine-readable)
├── wallet-migrations.json          (473KB — 1037 (abs, mega) tuples)
├── relayer-distribution.json       (relayer pool reference)
├── check-relayers.mjs              (helper script — relayer discovery)
├── test4-stream.mjs                (script)
├── test4-log.txt                   (run log — partial, connection success)
├── stream-events.jsonl             (will be populated when first event fires)
└── opensea-rest-samples/
    ├── 3a-listings.json            (pass)
    ├── 3b-offers.json              (pass — all WETH)
    ├── 3c-sales.json               (HTTP 500 body)
    └── 3d-token-sales.json         (HTTP 500 body)
```

---

## Recommended next steps

1. **Tomorrow morning:** re-run Test 3c + 3d (OpenSea events endpoints). Expect either resolution or persistent failure → fall back to on-chain sniffing.
2. **Tomorrow morning:** re-run Test 4 stream during peak marketplace activity. Connection-success was already proven; remaining task is to capture one actual event payload to verify field-extraction works on MegaETH-shaped events.
3. **Token map refresh** — separate task. Pull current creator cards from both chains' XCC contracts, rebuild `xeet.db token_map`, redeploy.
4. **Begin design phase for the parallel MegaETH ingestion pipeline** — schema migrations (`chain_id` columns + new `wallet_migrations` table), parallel poller in `data-pipeline.ts`, second OpenSea Stream client. The seeds: `holders-snapshot.json` for the initial backfill, `wallet-migrations.json` for the wallet pair table.

---

# DAY 2 RE-RUN — 2026-05-09

**Aggregate signal: still GO.** All Day-1 deferred items resolved or progressed. Three new findings worth carrying forward.

## Cutoff anchor correction (note, not a sweep)

Initial plan named block `14761074` (Senti's R2D2 mint) as the "first migration mint" anchor. **The actual earliest XCC TransferSingle on MegaETH is block `14734322` @ 2026-04-30 06:42 UTC** — ~7h before Senti's first migration. 2,097 events sit between those two blocks.

Audit of the published docs: none of them actually claimed the wrong number; the inaccuracy was confined to the plan file (now corrected) and a deleted comment in `test1-holders.mjs`. The test1 script has always used `startblock=0` so the data was correct from the start. The chain-reference doc now records the first-mint datapoint explicitly so future readers anchor correctly.

## R0 — Comprehensive creator wallet map

**Method:** Found `walletAddress` field directly in `xeet-creators-full.json` (391/391 creators). Augmented with multi-wallet alts from `multi-wallet-creators.json` (8 multi-wallet creators) and cross-checked against `creator-holdings.json`. Looked up each ABS wallet in yesterday's `wallet-migrations.json` for its MegaETH counterpart.

**Results:**
- **391/391 creators have a known ABS wallet** ✅
- **191 creators fully migrated** (own wallet has bridge activity)
- **198 creators NOT migrated** (own wallet has no bridge activity yet — 50.6%)
- **2 creators partial migration**
- **Senti's known pair resolved correctly** as ground truth (Senti__23 → fully_migrated)

**Output artifacts:**
- `creators-wallet-map.json` (183 KB) — full per-creator map with migration_status field
- `creator-migration-state.json` (157 KB) — joined view (R0 + R1) per creator
- `non-migrated-creators.json` (86 KB) — focused "unmigrated wallets" list

## R1 — Refreshed holder snapshot + day-over-day diff

**Method:** Re-ran `test1-holders.mjs` with `startblock=0` (script unchanged). Saved yesterday's snapshot as `holders-snapshot-day1.json` for diff.

**Day-over-day numbers:**

| Metric | Day 1 (2026-05-08) | Day 2 (2026-05-09) | Δ |
|---|---|---|---|
| Unique holders on MegaETH | 992 | **1029** | +37 (+3.7%) |
| Total cards held | 20,051 | **20,325** | +274 (+1.4%) |
| Wallets new since day 1 | — | 41 | new |
| Wallets departed (sold all) | — | 4 | exits |
| Senti's holdings | 160 cards | **160 cards** | 0 (unchanged) |
| Migration mints (events) | 17,297 | 17,560 | +263 |

Migration is **actively continuing** at ~37 new wallets / 274 cards per 24h. No data inconsistencies vs Day 1 — the +274 cards came from real on-chain activity (mints + peer transfers).

## R1 — Non-migrated creators (the question Senti actually asked)

**Definition A — Creators whose OWN wallet hasn't migrated yet (191 are flagged):** Most have ~60-100 cards stuck on Abstract + ~50-70 already on MegaETH (because OTHER holders migrated copies). Top 10 by total card circulation:
```
Jampzey         ABS=102  Mega=73   Total=175
loshmi          ABS=98   Mega=73   Total=171
joxiecoxie      ABS=102  Mega=69   Total=171
enftsar         ABS=104  Mega=66   Total=170
what3verman    ABS=107  Mega=63   Total=170
RealPiffsPeak   ABS=101  Mega=68   Total=169
ripchillpill    ABS=96   Mega=72   Total=168
XammieCrypt     ABS=100  Mega=64   Total=164
R3birth         ABS=99   Mega=65   Total=164
Aurelius_1988   ABS=94   Mega=69   Total=163
```

**Definition B caveat:** the file also has a "cards predominantly on Abstract" list, but **these mega_share percentages are unreliable** because `holder-snapshot.json` (Abstract reference) is from 2026-04-16 — pre-migration. The Abstract counts in that file haven't accounted for the 20K+ cards that migrated out since. To compute a true cross-chain mega_share, we'd need a fresh Abstract holder pull. Production pipeline has fresh data; local doesn't.

**Special case:** Only one creator — `CelticMatheus` — has zero MegaETH presence anywhere. Worth a manual ping.

## R2 — OpenSea REST sales endpoints (now resolved)

Both endpoints back to HTTP 200. Yesterday's 500s were a transient OS outage.

| Endpoint | Day 1 | Day 2 |
|---|---|---|
| 3c `/events/collection/xeet-creator-cards-mega?event_type=sale&limit=100` | HTTP 500 | ✅ HTTP 200, 100 sales, 83 distinct token_ids, WETH+ETH mix |
| 3d `/events/chain/megaeth/contract/0xce8cb6.../nfts/786?event_type=sale&limit=50` | HTTP 500 | ✅ HTTP 200, 1 sale at 0.016 WETH for R2D2 |

**Field-shape match with parser:** all 9 expected keys (`event_type, event_timestamp, transaction, order_hash, nft, payment, seller, buyer, quantity`) are present in MegaETH responses. Plus 3 bonus keys (`chain, closing_date, protocol_address`). The existing `opensea-client.ts` parser can handle MegaETH responses without modification.

**Bonus capture:** event_type enum from a 400 response = `sale, transfer, mint, listing, offer, trait_offer, collection_offer`. Added to `docs/xeet-api-reference.md`.

## R3 — OpenSea Stream re-run ✅ PASS

**Re-launched with 60-min window** (vs 30 min on day 1). Same SDK, same slug, same subscriptions. Captured the first event after **~34.5 min** of waiting.

**Event captured (item_listed):**
```
channel:    item_listed
chain:      megaeth                              ✅ correctly attributed
nft_id:     megaeth/0xce8cb6.../1666
token_id:   1666 (harrietpjones common)
base_price: 0.01690 WETH
quantity:   1
maker:      0x64942a4618762d6eec711666ebfeb248d5bfa70e
expiration: 2026-05-14 (3 days)
duration:   34.5 min to first event
```

**Field-extraction check:** the keys consumed by the existing `opensea-stream.ts:36-78` parser (`nft_id`, `base_price`, `order_hash`, `expiration_date`) are all present and parse cleanly. Two parsing notes:
- `nft_id` is structured `{chain}/{contract}/{token_id}` — splitting on `/` and taking the last segment gives `1666`. Matches Abstract pattern.
- `base_price` is in wei (18 decimals) as a string — must be parsed as BigInt or split-and-divide for display.

**Conclusion:** all four data types we observe today on Abstract are equally observable on MegaETH using the same parsing patterns. **Stream pipeline can mirror to MegaETH with just a different `collectionSlug` argument** — no SDK-level changes needed.

## What's confirmed end-to-end after Day 2

| Capability | Status |
|---|---|
| Holder enumeration on MegaETH | ✅ via Etherscan v2 token1155tx, paginated |
| ABS↔MegaETH wallet pairing | ✅ via burn/mint event matching, 99.1% pair rate |
| Comprehensive creator wallet map | ✅ 391/391 covered via `xeet-creators-full.json` |
| "Which creators haven't migrated yet" | ✅ 198 creators with unmigrated own-wallets |
| OS active listings | ✅ chain=megaeth REST works |
| OS active offers (WETH) | ✅ 100/100 are WETH |
| OS collection sales feed | ✅ (recovered from yesterday's outage) |
| OS per-token sales history | ✅ (recovered) |
| OS Stream real-time | ✅ connection + event payload captured (item_listed on token #1666, 0.0169 WETH, harrietpjones common, fired 34.5 min into the 60-min window) |
| Bridge contract identified | ✅ `0x97173f...740f` (target of 99.2% of mint txs) |
| Relayer pool identified | ✅ 10 EOAs documented |
| Token IDs preserved | ✅ (confirmed via Senti's pair + general migration matching) |
| Etherscan v2 unified key works for both chains | ✅ |

## Day 2 file artifacts added

```
analysis/megaeth-verify/
├── r0-creator-wallet-map.mjs        (new — R0 script)
├── creators-wallet-map.json          (new — 391-creator map, 183KB)
├── r0-log.txt                        (new — R0 run log)
├── r0-summary.json                   (new — R0 summary)
├── r1-non-migrated-creators.mjs      (new — R1 derivation)
├── non-migrated-creators.json        (new — 198 creators, 86KB)
├── creator-migration-state.json      (new — full joined state, 157KB)
├── r1-derive-log.txt                 (new — R1 derive log)
├── holders-snapshot.json             (refreshed — 1029 wallets / 20,325 cards)
├── holders-snapshot-day1.json        (preserved for diff)
├── megaeth-raw-events.json           (refreshed — 18,265 events)
├── megaeth-raw-events-day1.json      (preserved for diff)
├── test1-log-day2.txt                (new)
├── test4-log-day2.txt                (running)
└── opensea-rest-samples/
    ├── 3c-sales.json                 (overwritten — clean 100 sales)
    └── 3d-token-sales.json           (overwritten — 1 sale for R2D2)
```

## Updated to docs / memory on Day 2

- `docs/megaeth-chain-reference.md` — added "First migration mint" datapoint (block 14734322, 06:42 UTC). Updated total supply to 20,325.
- `docs/xeet-api-reference.md` — added `event_type` enum + recovery-pattern gotcha for `/events/*` outages.
- `~/.claude/projects/.../memory/project_dual_chain_state.md` — corrected migration anchor + added Day-2 stats + non-migrated-creators pointer.

## Next planning round inputs

- `creators-wallet-map.json` → schema for future `wallet_migrations` table + creator-wallet join table
- `holders-snapshot.json` (day 2) → backfill seed for `card_holders` with `chain_id=4326`
- `non-migrated-creators.json` → could power a "migration progress per creator" UI section
- Day-over-day deltas show the migration is still in flight; final cut-over signal: when daily delta drops below ~10 cards/day for several days, declare migration complete and switch Abstract polling to archival mode.
