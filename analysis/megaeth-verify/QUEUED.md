# Queued follow-up work (not done yet, deferred for later)

## 1. Push the 136 token_map additions to `xeet.db.token_map`
- Source: `analysis/megaeth-verify/token-map-additions.json` (136 rows, all validated)
- All entries pass the rarity CHECK constraint (no Epic/Mythic surprises)
- Operation: `INSERT OR IGNORE INTO token_map (token_id, creator_handle, rarity, name, image_url) VALUES (...)` per row, in one transaction
- **Production-impacting write** — don't do during read-only verification rounds
- Sanity to run after the push: re-query token_map row count → should jump from 846 to 982

## 2. Mirror the same refresh against Abstract
- Local `token_map` likely missing the equivalent legendary tail on the ABS side too
- Approach: enumerate distinct token_ids ever observed on Abstract XCC contract (`0xeC27D2...`) via Etherscan v2 `token1155tx` with `chainid=2741`, paginated; diff against local DB; fetch the missing IDs via OpenSea `/api/v2/chain/abstract/contract/.../nfts/{id}`
- Expected scope: similar pattern (~100-200 unmapped legendaries on ABS that never moved)
- Same script structure as `refresh-token-map.mjs` — just swap the chain param and contract

## 3. (Eventual, future planning round) Pipeline build
- Schema migrations: add `chain_id` to `sale_history`, `card_holders`; create `wallet_migrations` table
- Parallel MegaETH poller in `data-pipeline.ts`
- Second OpenSea Stream client for `xeet-creator-cards-mega`
- Backfill: `holders-snapshot.json` as initial `card_holders` seed; `wallet-migrations.json` as `wallet_migrations` seed
