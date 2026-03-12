**XEET CREATOR CARDS — SESSION LEARNINGS v2**  
*API Discovery, Marketplace Architecture, OpenSea Integration & Build Intelligence*  
Updated: March 12, 2026  |  For: Senti\_\_23  |  Build starts tomorrow

# **1\. MARKETPLACE ARCHITECTURE — WHAT WE DISCOVERED**

## **1.1 Critical Correction: Currency Is XEETS, Not ETH**

Previous session notes incorrectly assumed the marketplace used ETH as currency. The Xeet marketplace operates entirely in XEETS (the platform's native in-game currency). Cards can be purchased with both USD (via pack purchase) and XEETS. This distinction is fundamental for all pricing logic in any tool built on top of this platform.

## **1.2 Marketplace Is NOT an OpenSea Embed**

Earlier hypothesis was that Xeet's marketplace proxied OpenSea data. This was WRONG. Investigation via network request interception revealed:

* No OpenSea API calls fire from the marketplace page  
* No Reservoir SDK detected in JS bundles  
* The page uses Next.js App Router with Server Components (RSC) — data is server-rendered  
* Xeet operates its own fully independent marketplace with its own order book and listing system  
* OpenSea reference in JS bundle was for asset URL patterns only, not data

## **1.3 How the Page Actually Loads (RSC Architecture)**

The market page fires almost zero API calls on the client side. Key lesson: always trigger UI interactions (click tabs) before checking network requests on Next.js 13+ apps. The real endpoints only revealed themselves after clicking the 'Activity' tab.

# **2\. CONFIRMED WORKING APIs — FULL STACK**

## **2.1 Xeet Marketplace API (xeet.ai) — OPEN, NO AUTH**

| Endpoint | Status | Returns |
| :---- | :---- | :---- |
| /api/marketplace/discovery/items?status=ACTIVE\&sortBy=price\_asc\&limit=250 | 200 ✓ | Live listings in xeets, seller info, rarity, deadline, orderHash |
| /api/marketplace/discovery/activity?limit=96 | 200 ✓ | Trade history: sales, cancellations, timestamps |
| /api/user/handle/{username}/header | 200 ✓ | followerCount, ethosScore, credScore, xeetEarned |
| /api/user/handle/{username}/tournaments | 200 ✓ | Full tournament history per creator |
| /api/user/{userId}/cards | 200 ✓ session | Holdings — requires logged-in session cookie |
| /api/user/{userId}/packs | 200 ✓ session | Unopened packs |

### **Key Fields — Items Endpoint**

{ id, sellerId, sellerWalletAddress, tokenContract, tokenType (CARD/PACK),  
  xeetPrice, sellerSignature, deadline, orderHash, status, creatorId }

### **Key Fields — Activity Endpoint**

{ eventType (LISTING\_CANCELLED|SALE|LISTING), tokenType, tokenId,  
  assetName, rarity, priceXeets, sellerHandle, buyerHandle, timestamp }

## **2.2 Third-Party Tracker (xeet.mvc-web.xyz) — FULLY OPEN**

| Endpoint | Status | Returns |
| :---- | :---- | :---- |
| /api/stats | 200 ✓ | Global: 391 creators, 976 cards, 5,091 users, 31.3 ETH volume |
| /api/creators?page={n}\&limit=20 | 200 ✓ | Paginated creator profiles (20 pages, 391 creators) |
| /api/creators/{xHandle} | 200 ✓ | Individual creator detail |
| /api/users?page={n} | 200 ✓ | 5,091 users, 255 pages, buy/sell volume |
| /api/cards?rarity=legendary|rare|common | 200 ✓ | Cards filtered by rarity |
| /api/stats/pack-reveals?page={n} | 200 ✓ | Pack reveal history |

# **3\. OPENSEA API — FULLY CONFIRMED & WORKING**

**⚡ MAJOR UPDATE: All OpenSea integration is confirmed working. No setup needed.**

## **3.1 API Key — Already Have It**

Key obtained during the January 2026 crypto dashboard build. Confirmed working against the Xeet contract today.  
ddcaac6b9c624a58be000387dd275a17

## **3.2 Xeet Contract — Indexed on OpenSea**

Collection slug confirmed: xeet-creator-cards  |  Contract: 0xeC27D2237432D06981e1F18581494661517E1bD3

| OpenSea Endpoint | Status | Returns |
| :---- | :---- | :---- |
| /api/v2/chain/abstract/contract/{contract} | 200 ✓ | Contract info, slug, standard (erc1155) |
| /api/v2/collections/xeet-creator-cards | 200 ✓ | Collection metadata, image, description |
| /api/v2/collections/xeet-creator-cards/stats | 200 ✓ | Floor ETH, total volume, sales, owners, 24h data |
| /api/v2/listings/collection/xeet-creator-cards/all | 200 ✓ | All active ETH listings with full order data |
| /api/v2/events/collection/xeet-creator-cards?event\_type=sale | 200 ✓ | Sale events with buyer, seller, WETH price, tx hash |
| /api/v2/collection/xeet-creator-cards/nfts | 200 ✓ | NFT metadata, traits, images |
| /api/v2/events/chain/abstract/contract/{contract} | 404 ✗ | Chain-scoped events — use collection slug instead |

## **3.3 Live Stats From Today's Test**

| Metric | Value (March 12, 2026\) |
| :---- | :---- |
| Floor price | 0.001093 ETH |
| Total volume | 30.61 ETH |
| Total sales | 6,572 |
| Unique owners | 4,082 |
| 24h volume | 1.977 ETH |
| 24h sales | 320 |
| Payment token | WETH (on Abstract chain) |

## **3.4 Rate Limits**

OpenSea does not expose rate limit headers. Standard tier is 4 requests/second. For this tool running on 60s polling intervals, rate limits will never be an issue. No upgrades needed.

## **3.5 OpenSea Stream API — Live Notifications**

The Stream API enables WebSocket-based real-time event push. Instead of polling every 60s, OpenSea pushes events the moment they happen. This is the notification engine for the tool.

import { OpenSeaStreamClient } from '@opensea/stream-js';  
client.onItemListed('xeet-creator-cards', (event) \=\> { notify(user, event) })  
client.onItemSold('xeet-creator-cards', (event) \=\> { notify(user, event) })

The same API key works for Stream API — no separate auth needed.

## **3.6 Other OpenSea Tools (Developer Use Only)**

* CLI (@opensea/cli) — query API from terminal via npx. Useful for testing endpoints during build, not needed in production app  
* MCP server — lets Claude query OpenSea directly in future Claude sessions without browser tricks. Speeds up future dev work  
* Agent Skill — AI agent integration format, not relevant for this build

# **4\. DEAD ENDS — DO NOT RETRY**

## **4.1 Guessed Xeet API Routes (All 404\)**

The following were tested — all returned 404\. Correct method is UI interaction \+ network intercept, not pattern guessing:

* /api/market/listings, /api/market/floor, /api/xeet/market, /api/xeet/listings  
* /api/xeet/floor, /api/cards/market/floor, /api/market/cards/listings  
* /api/shop, /api/shop/listings, /api/shop/floor  
* /api/v2/events/chain/abstract/contract/{contract} — use collection slug route instead

## **4.2 External Marketplace Data — What Doesn't Work**

| Source | Status | Why Dead End |
| :---- | :---- | :---- |
| Blur API | ✗ Dead end | No public API — requires wallet signature |
| Magic Eden EVM | \~ Partial | Has floor price, NO 24h change |
| Alchemy getFloorPrice | \~ Partial | No 24h change, OpenSea \+ LooksRare only |
| Moralis Floor API | \~ Partial | Best aggregator but no native 24h change |
| OpenSea v1 stats | ✗ Deprecated | one\_day\_change existed in v1, removed in v2 |
| CoinGecko NFT floor | \~ Slow | Has 24h change but 4-5 min fetch due to rate limits |

**NOTE: OpenSea v2 /stats DOES return 24h floor\_price\_percentage\_change via the intervals array. This makes all of the above irrelevant for this project.**

# **5\. WHAT STILL REQUIRES ON-CHAIN QUERIES**

* Token holder breakdown — who holds which token IDs (AbScan ERC-1155 query, no key needed)  
* Real-time P2P transfers — detect wallet-to-wallet trades bypassing both Xeet and OpenSea marketplaces  
* totalSupply(tokenId) per token — verify supply vs Xeet's reported numbers

AbScan API: https://api.abscan.org/api  |  Abstract RPC: https://api.mainnet.abs.xyz  |  Chain ID: 2741

## **5.1 XEET/USD Rate Problem**

* Option A: Pack pricing ratio — if pack \= $X \= Y xeets, rate \= X/Y  
* Option B: Cross-reference cards sold on both Xeet (xeets) and OpenSea (WETH) simultaneously  
* Option C: Tournament earning rate as a proxy

# **6\. DECK BUILDER — COMPLETE DATA SOURCE MAP**

| Feature / Data Needed | Source | Auth Required? |
| :---- | :---- | :---- |
| User's current card holdings | xeet.ai /api/user/{id}/cards | Yes — session cookie |
| Live listings \+ floor (xeets) | xeet.ai /api/marketplace/discovery/items | No |
| Recent trades / sales (xeets) | xeet.ai /api/marketplace/discovery/activity | No |
| Floor price \+ 24h change (ETH) | OpenSea /collections/xeet-creator-cards/stats | API key ✓ have it |
| Live ETH listings | OpenSea /listings/collection/xeet-creator-cards/all | API key ✓ have it |
| Real-time listing notifications | OpenSea Stream API (@opensea/stream-js) | Same API key |
| Creator tournament performance | xeet.mvc-web.xyz /api/creators | No |
| Creator follower / score data | xeet.ai /api/user/handle/{h}/header | No |
| Who holds a specific card | AbScan ERC-1155 holder query | No (public) |
| Full historical sales | OpenSea events endpoint | API key ✓ have it |

# **7\. BUILD ARCHITECTURE — READY TO EXECUTE**

## **7.1 Data Layer (Polling \+ Stream)**

* Every 60s: Poll Xeet /api/marketplace/discovery/items — live xeets floor \+ listings  
* Every 60s: Poll Xeet /api/marketplace/discovery/activity — new xeets trades  
* Every 60s: Poll OpenSea /collections/xeet-creator-cards/stats — ETH floor \+ 24h change  
* Real-time (Stream): OpenSea WebSocket push for new listings and sales — zero latency  
* Every 5min: Poll mvc-web /api/creators — tournament \+ score data  
* On demand: AbScan queries for holder breakdown when a specific card is viewed  
* On wallet connect: fetch /api/user/{id}/cards for that user's holdings

## **7.2 Wallet Connect Flow**

* User inputs wallet address OR connects via Abstract Global Wallet (AGW supported)  
* Cross-reference wallet against mvc-web /api/users to find Xeet handle and userId  
* Fetch holdings via session (if logged in) OR via on-chain token balance query  
* Run deck analysis: holdings vs tournament performance matrix → suggest sells, buys, upgrades

## **7.3 Price Display Strategy**

* Primary: xeetPrice from Xeet marketplace (native, most accurate)  
* Secondary: ETH/WETH price from OpenSea listings (confirmed working, sales use WETH on Abstract)  
* USD: derive from pack price ratio — simplest reliable method  
* 24h change: available directly from OpenSea stats intervals — no snapshot storage needed

## **7.4 Notification Strategy**

* OpenSea Stream API: push notification when card listed on OpenSea (ETH)  
* Xeet API polling: detect new listings in /api/marketplace/discovery/items diff (xeets)  
* Browser notifications for desktop; Telegram bot (+1 day) for mobile

## **7.5 Timeline (No Blockers — Start Tomorrow)**

| Phase | Time | Key Deliverable |
| :---- | :---- | :---- |
| Phase 1: Core deck tracker | 2-3 days | Wallet input, holdings display, creator stats, deck score |
| Phase 2: Live marketplace prices | \+1 day | Xeet floor \+ OpenSea ETH floor with 24h change |
| Phase 3: OpenSea notifications | \+1-2 days | Stream API push for new listings/sales |
| Optional: Telegram bot | \+1 day | Mobile notifications via Telegram |

# **8\. KEY TECHNICAL LEARNINGS**

## **8.1 Network Interception Method**

* Always inject fetch interceptor BEFORE navigating  
* For Next.js 13+ RSC apps, data is server-rendered — interact with UI first then intercept  
* Must click tabs / apply filters to trigger actual client-side API calls

## **8.2 ERC-1155 Token ID Pattern (Confirmed)**

* Contract: 0xeC27D2237432D06981e1F18581494661517E1bD3 on Abstract (chain 2741\)  
* Token IDs are sequential. Senti\_\_23 Common \= 366, Rare \= 367\. Legendary IDs TBD post-pack-drop  
* OpenSea confirmed token 1747 was sold — far beyond the 848 theoretical minimum, packs have dropped

## **8.3 Session Cookie Auth for Holdings**

* Holdings endpoint requires valid session. Works if user is logged into Xeet on same browser  
* For the tool: user connects wallet → derive userId → fetch holdings client-side while logged in  
* Alt: ask user to paste their userId (visible in Xeet profile URL)

## **8.4 Marketplace Order Mechanics**

* Each Xeet listing has a sellerSignature (EIP-712) and orderHash — it's a signed on-chain order book  
* OpenSea listings use WETH as payment token on Abstract chain (not ETH directly)  
* Listings have deadlines — stale data is dangerous, always show listing expiry

*v2 — Xeet Tool Dev Intelligence — Senti\_\_23 / Orange Cap Games — March 12, 2026*