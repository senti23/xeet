# Xeet API Reference & Scraping Guide

> Documented April 2026 from reverse-engineering xeet.ai during tournament data collection.
> Updated with lessons from full V1 data collection (32 tournaments, verified).
> These are undocumented internal APIs — they may change without notice.

---

## Authentication

Most read endpoints work **without authentication** when called via `fetch()` in the browser console (inherits session cookie).

**Auth-gated endpoints:**
- `/api/topics/{slug}/tournament/quests` — returns 401 even with `credentials: 'include'` from MCP tabs. Only works via the page's own SSR requests.
- `/api/topics/{tid}/tournament/user-position` — requires active session

**No auth needed:**
- Leaderboard data (paginated)
- Topic/tournament resolver
- Tournament list

---

## Core Endpoints

### 1. Topic/Tournament Resolver

```
GET https://www.xeet.ai/api/topics/{slug}
```

Returns tournament metadata including the critical `tournamentId`.

**Response structure:**
```json
{
  "success": true,
  "data": {
    "entityType": "league",
    "hasActiveTournament": true,
    "tournamentId": "a06db660-112b-454d-b5b6-bb604d615207",
    "league": {
      "id": "832c1109-...",
      "title": "Thrust",
      "slug": "thrust",
      "xUrl": "https://x.com/thrustdotcom",
      "websiteUrl": "https://app.thrust.com/"
    },
    "activeTournament": {
      "id": "a06db660-...",
      "slug": "thurst",
      "title": "Thrust",
      "topicId": "7c40f54d-..."
    },
    "topic": {
      "id": "7c40f54d-...",
      "slug": "thrust",
      "name": "Thrust",
      "description": "..."
    }
  }
}
```

**Key fields:**
- `data.tournamentId` — needed for all leaderboard queries
- `data.league` — project metadata (X link, website)
- `data.topic.description` — used for niche categorization
- Note: `topicId` != `tournamentId` != `league.id` — three different UUIDs

**CRITICAL WARNING — Multi-drop tournaments:**
This endpoint returns the **active/latest** tournament. For multi-drop tournaments (iopn, adi, vdex, xeet), this may NOT be Drop 1. Always get the `tournamentId` from the **page URL** after navigating to the specific drop, not from this API.

---

### 2. Tournament Leaderboard (Paginated)

```
GET https://www.xeet.ai/api/topics/{slug}/tournament?page={N}&limit=50&timeframe=all&tournamentId={tournamentId}
```

**Parameters:**
| Param | Required | Notes |
|-------|----------|-------|
| `page` | Yes | 1-indexed |
| `limit` | Yes | Max 50 per page |
| `timeframe` | Yes | Use `all` for final standings |
| `tournamentId` | Yes | UUID from page URL, NOT from topic resolver |

**Response structure:**
```json
{
  "success": true,
  "data": [ ...array of participant objects... ],
  "meta": {
    "page": 1,
    "limit": 50,
    "total": 1908,
    "totalPages": 39,
    "asOfDate": "2025-11-08T00:00:00.000Z",
    "timeframe": "ALL",
    "sort": { "field": "total_points", "direction": "desc" },
    "xeetsEnabled": true,
    "showMultiplier": true,
    "currentUserPosition": null
  }
}
```

**Participant object fields:**
```json
{
  "id": "uuid",
  "tournamentId": "uuid",
  "userId": "uuid",
  "twitterId": "1234567890",
  "handle": "ProofOfEly",
  "name": "Ely",
  "avatarUrl": "https://...",
  "totalPoints": 359.978126,
  "signalPoints": 200.5,
  "noisePoints": 159.4,
  "pendingPoints": 0,
  "bonusPoints": 55.27,
  "multiplier": 1.0,
  "rankTotal": 1,
  "rankSignal": 1,
  "rankNoise": 2,
  "rankChange": 48,
  "isVerified": true,
  "followersCount": 15000,
  "xeetEarned": 20094
}
```

**Critical field distinctions:**

| Field | What it is | Displayed where |
|-------|-----------|-----------------|
| `totalPoints` | Tournament-specific score | Leaderboard "Xeets" column (as `Math.round(totalPoints)`) |
| `signalPoints` | Quality score component | Not prominently shown |
| `noisePoints` | Quantity/engagement component | Not prominently shown |
| `bonusPoints` | Points from multiplier boost | Part of totalPoints |
| `multiplier` | Boost multiplier (1.0 = no boost) | Shown as "1.5x" badge on leaderboard |
| `xeetEarned` | Current XEET token balance (lifetime) | User's profile page, sidebar badge |
| `rankTotal` | Leaderboard position | "#" column |
| `rankChange` | Rank movement (shown as +N) | Leaderboard "+N" indicator |

**The leaderboard "Xeets" column = `Math.round(totalPoints)`, NOT `xeetEarned`.**

Verified by cross-checking: Cris (@xinsanityo) shows 4,448 XEETS on profile (`xeetEarned`) but 315 on Kona leaderboard (`Math.round(totalPoints)` = `Math.round(315.438)` = 315).

---

### 3. Completed Tournaments List

```
GET https://www.xeet.ai/api/topics?status=completed&limit=50&page={N}
```

Returns paginated list of all completed tournament topics.

**Warning:** The `id` here is the **topic ID**, NOT the `tournamentId`. You still need the actual tournamentId from the page URL.

---

### 4. User Position in Tournament

```
GET https://www.xeet.ai/api/topics/{tournamentId}/tournament/user-position?tournamentId={tournamentId}&timeframe=all
```

Returns the logged-in user's position. Requires active session.

---

### 5. Tournament Quests/Multiplier Criteria (AUTH REQUIRED)

```
GET https://www.xeet.ai/api/topics/{slug}/tournament/quests?tournamentId={tournamentId}
```

Returns the quest/task definitions that determine multiplier eligibility. **Requires authentication** — does not work from MCP browser tabs or unauthenticated fetch. Only accessible via the page's own SSR context.

---

### 6. Reward Distribution

```
GET https://www.xeet.ai/api/tournaments/{tournamentId}/reward-distribution
```

Returns reward distribution details for the tournament.

---

### 7. User Profile

```
URL: https://www.xeet.ai/user/{handle}
```

Shows creator profile with:
- Total XEET balance (`xeetEarned`)
- Signal/Ethos scores
- Tournament history (with per-drop breakdown including rank, xeets, multiplier)
- Completed tournaments tab shows which drops they participated in

---

## Scraping Workflows

### Full Tournament Data Collection (Recommended — One at a Time)

**IMPORTANT: Never batch multiple tournaments in one async function. Process one tournament per JS execution to avoid data contamination.**

```javascript
// Step 1: Navigate to the tournament page in the browser
// Step 2: Get tournamentId from the URL (NOT from /api/topics/)
// Step 3: Run this script

(async () => {
  const tid = 'FROM-THE-URL-BAR';
  const slug = 'tournament-slug';
  const base = `https://www.xeet.ai/api/topics/${slug}/tournament?limit=50&timeframe=all&tournamentId=${tid}`;
  
  // Get metadata
  const r1 = await fetch(base + '&page=1');
  const d1 = await r1.json();
  const totalEntries = d1.meta.total;
  const totalPages = d1.meta.totalPages;
  
  // For large tournaments, first find where zeros start (binary search)
  // then only fetch pages with real participants
  let lo = 1, hi = totalPages, cutoff = totalEntries;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const r = await fetch(base + '&page=' + mid);
    const d = await r.json();
    const allGe1 = d.data.every(e => Math.round(e.totalPoints) >= 1);
    const hasGe1 = d.data.some(e => Math.round(e.totalPoints) >= 1);
    if (allGe1) { lo = mid + 1; }
    else if (hasGe1) {
      cutoff = [...d.data].reverse().find(e => Math.round(e.totalPoints) >= 1).rankTotal;
      break;
    } else { hi = mid - 1; }
  }
  if (lo > totalPages) cutoff = totalEntries;
  
  // Fetch only pages with real participants
  const maxPages = Math.ceil(cutoff / 50);
  let totalX = 0, count = 0, top10 = [];
  for (let p = 1; p <= maxPages; p++) {
    const r = await fetch(base + '&page=' + p);
    const d = await r.json();
    for (const e of d.data) {
      const v = Math.round(e.totalPoints);
      if (v >= 1) {
        totalX += v;
        count++;
        if (top10.length < 10) top10.push({
          rank: e.rankTotal, name: e.name, handle: e.handle,
          xeets: v, multiplier: e.multiplier
        });
      }
    }
  }
  
  // Get median (fetch middle page)
  const medianPage = Math.ceil(count / 2 / 50);
  const medianIdx = ((Math.ceil(count / 2) - 1) % 50);
  const rm = await fetch(base + '&page=' + medianPage);
  const dm = await rm.json();
  const median = Math.round(dm.data[Math.min(medianIdx, dm.data.length - 1)].totalPoints);
  
  // Verify top10 against page DOM
  const text = document.body.innerText;
  const section = text.substring(text.indexOf('Reward\n'), text.indexOf('Tournament Start'));
  const lines = section.split('\n');
  const pageTop = [];
  for (let i = 0; i < lines.length && pageTop.length < 10; i++) {
    const n = parseInt(lines[i]);
    if (n >= 1 && n <= 10 && /^\d+$/.test(lines[i].trim()) && i + 3 < lines.length)
      pageTop.push(`#${n} ${lines[i+1]}: ${lines[i+3]}`);
  }
  
  const t10s = top10.reduce((s, e) => s + e.xeets, 0);
  console.log('API top10:', top10.map(e => `#${e.rank} ${e.name}: ${e.xeets}`).join(', '));
  console.log('Page top10:', pageTop.join(', '));
  console.log(`total=${totalEntries} real=${count} xeets=${totalX} avg=${(totalX/count).toFixed(1)} median=${median}`);
  
  // Store result
  window._result = JSON.stringify({
    slug, tid, totalEntries, realParticipants: count,
    totalXeets: totalX, avg: +(totalX/count).toFixed(1), median,
    top10Pct: +((t10s/totalX)*100).toFixed(1), top10
  });
})();
```

### Getting Median Only (Quick — 1 API call)

```javascript
// If you already know realParticipants count
const medianRank = Math.ceil(realParticipants / 2);
const medianPage = Math.ceil(medianRank / 50);
const medianIdx = ((medianRank - 1) % 50);
const r = await fetch(`${base}&page=${medianPage}`);
const d = await r.json();
const median = Math.round(d.data[medianIdx].totalPoints);
```

### Checking for Multi-Drop Tournaments

Navigate to the tournament page and look for a "Drop N" dropdown selector. Or check via API:

```javascript
const resp = await fetch('https://www.xeet.ai/api/topics/' + slug);
const data = await resp.json();
// If activeTournament.slug ends in -2, -3 etc, there are multiple drops
// e.g. "iopn-2" means at least 2 drops exist
```

Known multi-drop tournaments (V1):
- `xeet` — 2 drops
- `iopn` — 3 drops  
- `adi` — 2 drops (drop 2 cancelled)
- `vdex` — 2 drops (drop 2 empty)

---

## Key Data Files

| File | Contents |
|------|----------|
| `tournament-difficulty-data.json` | Per-tournament: participants, xeets, top10, rewards, multiplier criteria, dates, niche |
| `tournament-difficulty-table.csv` | Sortable table: real participants, xeets, avg, median, win rate, duration |
| `xeet-creators-enriched.json` | Per-XCC per-tournament: rank, xeets, multiplier value, signal/noise breakdown |

---

## V2 Tournament Collection Playbook

When V2 tournaments launch, follow this process:

### 1. Discover new tournaments
```
GET https://www.xeet.ai/api/topics?status=active&limit=50
```
Or check `https://www.xeet.ai/tournaments` (Featured tab).

### 2. For each new tournament:
1. Navigate to `https://www.xeet.ai/tournaments/{slug}?tab=tournament`
2. Copy `tournamentId` from the URL bar
3. Note the drop selector — if it shows "Drop 1", expect future drops
4. Extract from page: reward pool, reward details, eligible winners, dates, description
5. Run the full collection script above (one tournament at a time!)
6. Verify top10 against the page before saving
7. Check for multipliers: look for badges on leaderboard entries, or check `meta.showMultiplier` in API response

### 3. For live monitoring during active tournaments:
```javascript
// Quick snapshot — just page 1 + metadata
const r = await fetch(`${base}&page=1`);
const d = await r.json();
console.log(`${d.meta.total} total, page 1 top: ${d.data[0].name} (${Math.round(d.data[0].totalPoints)})`);
```

### 4. For XCC creator tracking:
Check specific creator's tournament position:
```
Navigate to: https://www.xeet.ai/user/{handle}
Click "Tournaments" tab → filter by "Live" or "Completed"
```
Each entry shows: rank, signal, noise, bonus, xeets, multiplier per drop.

---

## URL Patterns

| What | URL Pattern |
|------|-------------|
| Tournament page | `https://www.xeet.ai/tournaments/{slug}?tab=tournament` |
| Specific drop | `https://www.xeet.ai/tournaments/{slug}?tab=tournament&tournamentId={tid}` |
| User profile | `https://www.xeet.ai/user/{handle}` |
| Tournaments list | `https://www.xeet.ai/tournaments?view=completed` |
| Active tournaments | `https://www.xeet.ai/tournaments` (Featured tab) |

---

## Gotchas & Lessons Learned

### Critical (data integrity)

1. **NEVER batch tournaments in one async function.** This caused data contamination in V1 collection — top10 entries from one tournament bled into another. Process ONE tournament per JS execution, verify against the page, then move to the next.

2. **Always get tournamentId from the page URL, not from `/api/topics/{slug}`.** The topic resolver returns the ACTIVE/LATEST tournament, which may be Drop 2 or 3 for multi-drop tournaments. The page URL is the source of truth.

3. **Verify top10 against the rendered page.** After every API collection, compare the API's top 10 names and xeet values against what the page shows. If they don't match, the data is wrong — don't save it.

4. **For large tournaments (50+ pages), split into chunks of ~50 pages.** Processing 90+ pages in a single async function can cause the browser tab to freeze/timeout.

### Important (data interpretation)

5. **Three different IDs**: `topicId` != `tournamentId` != `league.id`. The leaderboard API requires `tournamentId` specifically.

6. **totalPoints vs xeetEarned**: The leaderboard "Xeets" column shows `Math.round(totalPoints)` (tournament score), NOT `xeetEarned` (lifetime XEET balance).

7. **Participation inflation**: `meta.total` includes everyone registered (even 0 score). Real participants (>=1 displayed XEET) are typically 18-97% of total, averaging ~60%.

8. **Multiplier field**: The `multiplier` field on each leaderboard entry shows the user's boost value. A value of 1.0 means no boost. The CRITERIA for earning multipliers are in the quests endpoint (auth-gated) — must be checked manually on the tournament page.

9. **Cancelled tournaments**: Some tournaments (cryptoys, adi drop 2, datahaven) were cancelled. They still have leaderboard data but no rewards were distributed.

10. **Slug mismatches**: Tournament slugs sometimes differ from topic slugs (e.g., "thurst" vs "thrust", "adi-2" vs "adi"). Always use the topic slug for API calls.

### Operational

11. **No rate limiting observed** on the leaderboard API. Processed hundreds of sequential page fetches without issues. But don't batch concurrent requests — sequential is safer and fast enough.

12. **Session cookies from MCP tab groups don't pass to fetch().** The quests endpoint returns 401 even with `credentials: 'include'`. For auth-gated endpoints, must read from the page's rendered content or network requests.

13. **localStorage persists across page navigations on xeet.ai.** Use it to accumulate results across tournament pages instead of window variables (which are lost on navigation).

14. **Page rendering**: The leaderboard is SSR (Next.js). The initial page load includes data but subsequent page changes are client-side API calls visible in the network tab.
