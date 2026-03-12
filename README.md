# Xeet Creator Cards — Market Intelligence & Alert System

Live dashboard and Telegram alert bot for Xeet Creator Cards across the Xeet marketplace and OpenSea.

## Features

### Live Listings Dashboard (Web)
- Floor prices for all 391 creators × 3 rarities (Common, Rare, Legendary)
- Xeet marketplace prices (XEETS) and OpenSea prices (ETH + USD estimate)
- Listing counts per creator/rarity on each marketplace
- Best WETH offer per token (OpenSea)
- Last sale prices from both marketplaces
- Search, filter by rarity, sort by any column
- Auto-refreshes every 60 seconds

### Telegram Alert Bot
- Real-time alerts when listings appear at or below your price thresholds
- Monitors both marketplaces: OpenSea (ETH) and Xeet (XEETS)
- OpenSea alerts via WebSocket (instant), Xeet alerts via 60s polling
- Multi-user with invite code access control
- Deduplicates: won't re-alert same listing at same price, but alerts on new lower listings

## Setup

### Prerequisites
- Node.js 18+
- npm

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Edit `.env`:
```
OPENSEA_API_KEY=your_opensea_api_key
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_INVITE_CODES=CODE1,CODE2,CODE3
PORT=3001
```

### 3. Create Telegram Bot (BotFather)

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`
3. Choose a name (e.g., "Xeet Card Alerts")
4. Choose a username (e.g., `xeet_card_alerts_bot`)
5. Copy the bot token and paste it into `.env` as `TELEGRAM_BOT_TOKEN`
6. (Optional) Send `/setcommands` to BotFather and paste:
   ```
   start - Welcome message
   redeem - Activate with invite code
   subscribe - Set up price alert
   unsubscribe - Remove alert subscription
   list - View active subscriptions
   help - Show all commands
   ```

### 4. Start the server
```bash
cd server && npm run dev
```
This starts:
- Fastify API on port 3001
- Data pipeline (60s polling cycle)
- OpenSea WebSocket stream (real-time)
- Telegram bot (if token is set)

### 5. Start the web dashboard
```bash
cd web && npm run dev
```
Opens on http://localhost:3000

## Telegram Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/redeem CODE` | Activate with invite code |
| `/subscribe creator rarity eth:0.05 xeets:500` | Create alert |
| `/list` | View active subscriptions |
| `/unsubscribe ID` | Remove subscription |
| `/unsubscribe all` | Remove all subscriptions |
| `/help` | Command guide |

**Examples:**
```
/subscribe senti__23 rare eth:0.05
/subscribe bearish_af common xeets:500
/subscribe tolibear_ legendary eth:0.1 xeets:1000
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/listings` | All creator/rarity data with filters |
| `GET /api/stats` | Collection-level aggregates |
| `GET /api/health` | Health check |

Query params for `/api/listings`: `search`, `rarity`, `sort`, `order`, `page`, `limit`

## Architecture

Single Node.js process hosting:
- **Fastify API** — serves cached data to the frontend
- **Data Pipeline** — 60s polling cycle across Xeet, OpenSea, and MVC-web APIs
- **OpenSea Stream** — WebSocket for real-time listing/sale events
- **Telegram Bot** — subscription management and alert dispatch
- **SQLite** — persists token maps, subscriptions, alert history, invite codes

## Running Tests

```bash
# API probe (tests live API connectivity)
npx tsx tests/api-probe.test.ts

# Pipeline & DB tests
npx tsx tests/pipeline.test.ts

# Alert engine tests
npx tsx tests/alerts.test.ts
```

## Tech Stack

TypeScript, Fastify, Next.js 14, SQLite (better-sqlite3), Telegraf, @opensea/stream-js, Pino, Tailwind CSS
