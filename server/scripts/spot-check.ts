/**
 * Spot-check: compare DB sales against live API responses for specific creators.
 *
 * Usage:
 *   npx tsx scripts/spot-check.ts ProofOfEly     # check one creator
 *   npx tsx scripts/spot-check.ts                 # check 10 random + known gaps
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Bootstrap config so API clients can read env vars
import '../src/config.js';
import * as xeetClient from '../src/services/xeet-client.js';
import * as osClient from '../src/services/opensea-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../../xeet.db');
const CREATORS_JSON = resolve(__dirname, '../../xeet-creators-full.json');

const db = new Database(DB_PATH, { readonly: true });

// Check if sale_history exists
const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(r => r.name);
const hasSaleHistory = tables.includes('sale_history');

type Rarity = 'common' | 'rare' | 'legendary';

// Load seed for supply data
const seedCreators: Array<{
  xHandle: string;
  cards?: { commonSupply: number; rareSupply: number; legendarySupply: number };
}> = JSON.parse(readFileSync(CREATORS_JSON, 'utf-8'));

const seedMap = new Map(seedCreators.map(c => [c.xHandle.toLowerCase(), c]));

// Determine which creators to check
const arg = process.argv[2];
let handles: string[] = [];

if (arg) {
  handles = [arg.toLowerCase()];
} else {
  // Pick 10 random + known problem creators
  const allHandles = seedCreators
    .filter(c => (c.cards?.commonSupply ?? 0) + (c.cards?.rareSupply ?? 0) + (c.cards?.legendarySupply ?? 0) > 0)
    .map(c => c.xHandle.toLowerCase());

  // Known gaps / interesting creators to always check
  const alwaysCheck = ['proofofely', 'xeetdotai', 'bearish_af', 'greenytrades', 'adriadri', 'coperto_xbt'];
  const remaining = allHandles.filter(h => !alwaysCheck.includes(h));

  // Shuffle and pick 10 random
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }

  handles = [...alwaysCheck.filter(h => allHandles.includes(h)), ...remaining.slice(0, 10)];
}

async function checkCreator(handle: string): Promise<void> {
  console.log('\n┌' + '─'.repeat(70) + '┐');
  console.log(`│  ${handle.padEnd(68)} │`);
  console.log('├' + '─'.repeat(70) + '┤');

  const seed = seedMap.get(handle);
  if (!seed) {
    console.log(`│  NOT IN SEED JSON — skipping`.padEnd(71) + '│');
    console.log('└' + '─'.repeat(70) + '┘');
    return;
  }

  // Get token IDs from token_map
  const tokenRows = db.prepare(
    'SELECT token_id, rarity FROM token_map WHERE creator_handle = ?',
  ).all(handle) as Array<{ token_id: string; rarity: string }>;

  if (tokenRows.length === 0) {
    console.log(`│  NO MAPPED TOKENS — cannot verify`.padEnd(71) + '│');
    console.log('└' + '─'.repeat(70) + '┘');
    return;
  }

  const tokensByRarity = new Map<Rarity, string[]>();
  for (const r of tokenRows) {
    const rarity = r.rarity as Rarity;
    const arr = tokensByRarity.get(rarity) ?? [];
    arr.push(r.token_id);
    tokensByRarity.set(rarity, arr);
  }

  let totalXeetApi = 0, totalXeetDb = 0, totalXeetVolumeApi = 0, totalXeetVolumeDb = 0;
  let totalOsApi = 0, totalOsDb = 0, totalOsVolumeApi = 0, totalOsVolumeDb = 0;
  let mismatches = 0;

  const rarities: Rarity[] = ['common', 'rare', 'legendary'];
  for (const rarity of rarities) {
    const supply = rarity === 'common' ? seed.cards?.commonSupply ?? 0
      : rarity === 'rare' ? seed.cards?.rareSupply ?? 0
      : seed.cards?.legendarySupply ?? 0;
    if (supply === 0) continue;

    const tokens = tokensByRarity.get(rarity) ?? [];

    // Xeet API check
    let apiXeetSales = 0;
    let apiXeetVolume = 0;
    for (const tokenId of tokens) {
      try {
        const sales = await xeetClient.getCardSalesHistory(tokenId);
        apiXeetSales += sales.length;
        for (const s of sales) apiXeetVolume += s.priceXeets ?? 0;
      } catch {
        // API error — skip
      }
    }

    // OpenSea API check
    let apiOsSales = 0;
    let apiOsVolume = 0;
    for (const tokenId of tokens) {
      try {
        const sales = await osClient.getTokenSaleEvents(tokenId);
        apiOsSales += sales.length;
        for (const s of sales) {
          const price = Number(s.payment?.quantity ?? 0) / Math.pow(10, s.payment?.decimals ?? 18);
          apiOsVolume += price;
        }
      } catch {
        // API error — skip
      }
    }

    // DB check
    let dbXeetSales = 0, dbXeetVolume = 0, dbOsSales = 0, dbOsVolume = 0;
    if (hasSaleHistory) {
      const xr = db.prepare(`
        SELECT COUNT(*) as sales, COALESCE(SUM(price), 0) as volume
        FROM sale_history WHERE creator_handle = ? AND rarity = ? AND marketplace = 'xeet'
      `).get(handle, rarity) as any;
      dbXeetSales = xr.sales;
      dbXeetVolume = xr.volume;

      const or = db.prepare(`
        SELECT COUNT(*) as sales, COALESCE(SUM(price), 0) as volume
        FROM sale_history WHERE creator_handle = ? AND rarity = ? AND marketplace = 'opensea'
      `).get(handle, rarity) as any;
      dbOsSales = or.sales;
      dbOsVolume = or.volume;
    }

    totalXeetApi += apiXeetSales;
    totalXeetDb += dbXeetSales;
    totalXeetVolumeApi += apiXeetVolume;
    totalXeetVolumeDb += dbXeetVolume;
    totalOsApi += apiOsSales;
    totalOsDb += dbOsSales;
    totalOsVolumeApi += apiOsVolume;
    totalOsVolumeDb += dbOsVolume;

    const xeetMatch = apiXeetSales === dbXeetSales ? 'OK' : 'MISMATCH';
    const osMatch = apiOsSales === dbOsSales ? 'OK' : 'MISMATCH';
    if (xeetMatch !== 'OK' || osMatch !== 'OK') mismatches++;

    const line = `│  ${rarity.padEnd(10)} ` +
      `Xeet: ${String(dbXeetSales).padStart(3)}/${String(apiXeetSales).padStart(3)} sales ` +
      `${String(Math.round(dbXeetVolume)).padStart(6)}/${String(Math.round(apiXeetVolume)).padStart(6)} XEETS [${xeetMatch.padEnd(8)}] ` +
      `OS: ${String(dbOsSales).padStart(2)}/${String(apiOsSales).padStart(2)} [${osMatch}]`;
    console.log(line.padEnd(71) + '│');
  }

  // Summary line for easy MVC-web comparison
  console.log('├' + '─'.repeat(70) + '┤');
  const summaryLine = `│  TOTAL:   ` +
    `Xeet: ${totalXeetDb} sales / ${Math.round(totalXeetVolumeDb)} XEETS  |  ` +
    `OpenSea: ${totalOsDb} sales / ${(totalOsVolumeDb).toFixed(4)} ETH`;
  console.log(summaryLine.padEnd(71) + '│');

  if (mismatches > 0) {
    const apiLine = `│  FROM API: Xeet: ${totalXeetApi} sales / ${Math.round(totalXeetVolumeApi)} XEETS  |  ` +
      `OpenSea: ${totalOsApi} sales / ${(totalOsVolumeApi).toFixed(4)} ETH`;
    console.log(apiLine.padEnd(71) + '│');
    console.log(`│  ^^^ Compare DB vs API above. Cross-check with MVC-web cards page`.padEnd(71) + '│');
  } else {
    console.log(`│  ALL MATCH — DB data matches live APIs`.padEnd(71) + '│');
  }

  console.log('└' + '─'.repeat(70) + '┘');
}

async function main() {
  console.log(`\nSpot-checking ${handles.length} creator(s)...`);
  if (!hasSaleHistory) {
    console.log('WARNING: sale_history table does not exist — DB columns will show 0');
  }

  for (const handle of handles) {
    await checkCreator(handle);
  }

  console.log('\nDone. Compare TOTAL lines against https://xeet.mvc-web.xyz/cards\n');
  db.close();
}

main().catch((err) => {
  console.error('Spot-check failed:', err);
  db.close();
  process.exit(1);
});
