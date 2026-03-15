/**
 * Verify the dataset — shows top 20 most traded cards.
 *
 * Usage:
 *   npx tsx scripts/verify-dataset.ts          # both rankings
 *   npx tsx scripts/verify-dataset.ts volume    # by volume only
 *   npx tsx scripts/verify-dataset.ts sales     # by sale count only
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../../xeet.db');
const CREATORS_JSON = resolve(__dirname, '../../xeet-creators-full.json');

const db = new Database(DB_PATH, { readonly: true });

const mode = process.argv[2] || 'both';

// ── DB stats ──
const total = (db.prepare('SELECT COUNT(*) as c FROM sale_history').get() as any).c;
const xeetCount = (db.prepare("SELECT COUNT(*) as c FROM sale_history WHERE marketplace = 'xeet'").get() as any).c;
const osCount = (db.prepare("SELECT COUNT(*) as c FROM sale_history WHERE marketplace = 'opensea'").get() as any).c;
const uniqueCreators = (db.prepare('SELECT COUNT(DISTINCT creator_handle) as c FROM sale_history').get() as any).c;
const earliest = (db.prepare('SELECT MIN(sold_at) as d FROM sale_history').get() as any).d;
const latest = (db.prepare('SELECT MAX(sold_at) as d FROM sale_history').get() as any).d;

console.log('\n' + '═'.repeat(72));
console.log('  DATASET STATUS');
console.log('═'.repeat(72));
console.log(`  Total sales:     ${total} (Xeet: ${xeetCount}, OpenSea: ${osCount})`);
console.log(`  Creators:        ${uniqueCreators}`);
console.log(`  Date range:      ${earliest ?? 'n/a'} → ${latest ?? 'n/a'}`);
console.log('═'.repeat(72));

if (total === 0) {
  console.log('\n  ⚠  No sales data yet. Run the collector first:');
  console.log('     cd server && npm run collect:backfill\n');
  process.exit(0);
}

// ── Top 20 by volume ──
if (mode === 'both' || mode === 'volume') {
  const byVolume = db.prepare(`
    SELECT
      creator_handle,
      rarity,
      COUNT(*) as sales,
      ROUND(SUM(CASE WHEN marketplace = 'xeet' THEN price ELSE 0 END), 1) as xeet_volume,
      ROUND(SUM(CASE WHEN marketplace = 'opensea' THEN price ELSE 0 END), 6) as os_volume_eth,
      COUNT(CASE WHEN marketplace = 'xeet' THEN 1 END) as xeet_sales,
      COUNT(CASE WHEN marketplace = 'opensea' THEN 1 END) as os_sales,
      MIN(sold_at) as first_sale,
      MAX(sold_at) as last_sale
    FROM sale_history
    GROUP BY creator_handle, rarity
    ORDER BY xeet_volume DESC
    LIMIT 20
  `).all() as any[];

  console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│  TOP 20 CARDS BY TOTAL XEET VOLUME                                │');
  console.log('├────┬────────────────────┬───────────┬──────────┬──────────┬────────┤');
  console.log('│  # │ Creator            │ Rarity    │ Xeet Vol │ ETH Vol  │ Sales  │');
  console.log('├────┼────────────────────┼───────────┼──────────┼──────────┼────────┤');

  byVolume.forEach((row: any, i: number) => {
    const num = String(i + 1).padStart(2);
    const creator = row.creator_handle.slice(0, 18).padEnd(18);
    const rarity = row.rarity.padEnd(9);
    const xVol = String(row.xeet_volume).padStart(8);
    const eVol = String(row.os_volume_eth).padStart(8);
    const sales = String(row.sales).padStart(6);
    console.log(`│ ${num} │ ${creator} │ ${rarity} │ ${xVol} │ ${eVol} │ ${sales} │`);
  });

  console.log('└────┴────────────────────┴───────────┴──────────┴──────────┴────────┘');
}

// ── Top 20 by sale count ──
if (mode === 'both' || mode === 'sales') {
  const bySales = db.prepare(`
    SELECT
      creator_handle,
      rarity,
      COUNT(*) as sales,
      ROUND(SUM(CASE WHEN marketplace = 'xeet' THEN price ELSE 0 END), 1) as xeet_volume,
      ROUND(SUM(CASE WHEN marketplace = 'opensea' THEN price ELSE 0 END), 6) as os_volume_eth,
      COUNT(CASE WHEN marketplace = 'xeet' THEN 1 END) as xeet_sales,
      COUNT(CASE WHEN marketplace = 'opensea' THEN 1 END) as os_sales
    FROM sale_history
    GROUP BY creator_handle, rarity
    ORDER BY sales DESC
    LIMIT 20
  `).all() as any[];

  console.log('\n┌─────────────────────────────────────────────────────────────────────┐');
  console.log('│  TOP 20 CARDS BY TOTAL SALE COUNT                                 │');
  console.log('├────┬────────────────────┬───────────┬────────┬──────────┬──────────┤');
  console.log('│  # │ Creator            │ Rarity    │ Sales  │ Xeet Vol │ ETH Vol  │');
  console.log('├────┼────────────────────┼───────────┼────────┼──────────┼──────────┤');

  bySales.forEach((row: any, i: number) => {
    const num = String(i + 1).padStart(2);
    const creator = row.creator_handle.slice(0, 18).padEnd(18);
    const rarity = row.rarity.padEnd(9);
    const sales = String(row.sales).padStart(6);
    const xVol = String(row.xeet_volume).padStart(8);
    const eVol = String(row.os_volume_eth).padStart(8);
    console.log(`│ ${num} │ ${creator} │ ${rarity} │ ${sales} │ ${xVol} │ ${eVol} │`);
  });

  console.log('└────┴────────────────────┴───────────┴────────┴──────────┴──────────┘');
}

// ── Top 20 creators by combined Xeet volume (all rarities) ──
if (mode === 'both' || mode === 'volume') {
  const byCreatorVolume = db.prepare(`
    SELECT
      creator_handle,
      COUNT(CASE WHEN marketplace = 'xeet' THEN 1 END) as xeet_sales,
      ROUND(SUM(CASE WHEN marketplace = 'xeet' THEN price ELSE 0 END), 1) as xeet_volume,
      COUNT(CASE WHEN marketplace = 'opensea' THEN 1 END) as os_sales,
      ROUND(SUM(CASE WHEN marketplace = 'opensea' THEN price ELSE 0 END), 6) as os_volume_eth,
      COUNT(*) as total_sales,
      GROUP_CONCAT(DISTINCT rarity) as rarities
    FROM sale_history
    GROUP BY creator_handle
    ORDER BY xeet_volume DESC
    LIMIT 20
  `).all() as any[];

  console.log('\n┌──────────────────────────────────────────────────────────────────────────────┐');
  console.log('│  TOP 20 CREATORS BY XEET VOLUME (ALL RARITIES COMBINED)                     │');
  console.log('├────┬────────────────────┬──────────┬────────┬──────────┬────────┬────────────┤');
  console.log('│  # │ Creator            │ Xeet Vol │ X.Sales│ ETH Vol  │OS.Sales│ Rarities   │');
  console.log('├────┼────────────────────┼──────────┼────────┼──────────┼────────┼────────────┤');

  byCreatorVolume.forEach((row: any, i: number) => {
    const num = String(i + 1).padStart(2);
    const creator = row.creator_handle.slice(0, 18).padEnd(18);
    const xVol = String(row.xeet_volume).padStart(8);
    const xSales = String(row.xeet_sales).padStart(6);
    const eVol = String(row.os_volume_eth).padStart(8);
    const oSales = String(row.os_sales).padStart(6);
    const rarities = (row.rarities || '').slice(0, 10).padEnd(10);
    console.log(`│ ${num} │ ${creator} │ ${xVol} │ ${xSales} │ ${eVol} │ ${oSales} │ ${rarities} │`);
  });

  console.log('└────┴────────────────────┴──────────┴────────┴──────────┴────────┴────────────┘');
}

// ── Marketplace breakdown ──
if (mode === 'both') {
  const breakdown = db.prepare(`
    SELECT marketplace, COUNT(*) as sales,
      COUNT(DISTINCT creator_handle) as creators,
      COUNT(DISTINCT token_id) as tokens
    FROM sale_history
    GROUP BY marketplace
  `).all() as any[];

  console.log('\n┌───────────────────────────────────────────┐');
  console.log('│  MARKETPLACE BREAKDOWN                    │');
  console.log('├─────────────┬────────┬──────────┬─────────┤');
  console.log('│ Marketplace │ Sales  │ Creators │ Tokens  │');
  console.log('├─────────────┼────────┼──────────┼─────────┤');
  for (const row of breakdown) {
    const mp = row.marketplace.padEnd(11);
    const sales = String(row.sales).padStart(6);
    const creators = String(row.creators).padStart(8);
    const tokens = String(row.tokens).padStart(7);
    console.log(`│ ${mp} │ ${sales} │ ${creators} │ ${tokens} │`);
  }
  console.log('└─────────────┴────────┴──────────┴─────────┘');
}

// ── Volume summary (for cross-checking with marketplace totals) ──
{
  const xeetVol = db.prepare(`
    SELECT ROUND(SUM(price), 2) as total, COUNT(*) as sales
    FROM sale_history WHERE marketplace = 'xeet'
  `).get() as any;

  const osVol = db.prepare(`
    SELECT
      ROUND(SUM(price), 6) as total,
      ROUND(SUM(CASE WHEN currency = 'ETH' THEN price ELSE 0 END), 6) as eth_vol,
      ROUND(SUM(CASE WHEN currency = 'WETH' THEN price ELSE 0 END), 6) as weth_vol,
      COUNT(*) as sales,
      COUNT(CASE WHEN currency = 'ETH' THEN 1 END) as eth_sales,
      COUNT(CASE WHEN currency = 'WETH' THEN 1 END) as weth_sales
    FROM sale_history WHERE marketplace = 'opensea'
  `).get() as any;

  console.log('\n' + '═'.repeat(72));
  console.log('  VOLUME SUMMARY (use to cross-check with marketplace pages)');
  console.log('═'.repeat(72));
  console.log(`  Xeet Marketplace:`);
  console.log(`    Total volume:   ${xeetVol.total ?? 0} XEETS  (${xeetVol.sales} sales)`);
  console.log(`  OpenSea:`);
  console.log(`    Total volume:   ${osVol.total ?? 0} ETH  (${osVol.sales} sales)`);
  console.log(`      ETH only:     ${osVol.eth_vol ?? 0} ETH  (${osVol.eth_sales} sales)`);
  console.log(`      WETH only:    ${osVol.weth_vol ?? 0} ETH  (${osVol.weth_sales} sales)`);
  console.log('═'.repeat(72));
}

// ── Token map coverage diagnostic ──
{
  // Load creator seed to compare
  let seedCreators: Array<{ xHandle: string; cards?: { commonSupply: number; rareSupply: number; legendarySupply: number } }> = [];
  try {
    seedCreators = JSON.parse(readFileSync(CREATORS_JSON, 'utf-8'));
  } catch { /* file not found */ }

  const tokenMapCount = (db.prepare('SELECT COUNT(*) as c FROM token_map').get() as any).c;
  const tokenMapCreators = (db.prepare('SELECT COUNT(DISTINCT creator_handle) as c FROM token_map').get() as any).c;

  // Creators with cards in seed
  const seedWithCards = seedCreators.filter(c => {
    const cs = c.cards?.commonSupply ?? 0;
    const rs = c.cards?.rareSupply ?? 0;
    const ls = c.cards?.legendarySupply ?? 0;
    return cs + rs + ls > 0;
  });

  // Expected total card types (creator+rarity combos)
  let expectedCardTypes = 0;
  for (const c of seedCreators) {
    if ((c.cards?.commonSupply ?? 0) > 0) expectedCardTypes++;
    if ((c.cards?.rareSupply ?? 0) > 0) expectedCardTypes++;
    if ((c.cards?.legendarySupply ?? 0) > 0) expectedCardTypes++;
  }

  // Creators in token_map vs seed
  const mappedHandles = new Set(
    (db.prepare('SELECT DISTINCT creator_handle FROM token_map').all() as any[]).map(r => r.creator_handle),
  );
  const saleHandles = new Set(
    (db.prepare('SELECT DISTINCT creator_handle FROM sale_history').all() as any[]).map(r => r.creator_handle),
  );
  const seedHandleSet = new Set(seedCreators.map(c => c.xHandle.toLowerCase()));

  // Creators in sales but NOT in token_map (came via Xeet API's creatorHandle field)
  const salesOnlyCreators = [...saleHandles].filter(h => !mappedHandles.has(h));

  // Creators in seed with cards but missing from both token_map and sales
  const fullyMissing = seedWithCards.filter(c => {
    const h = c.xHandle.toLowerCase();
    return !mappedHandles.has(h) && !saleHandles.has(h);
  });

  // Token map coverage by rarity
  const mapByRarity = db.prepare(`
    SELECT rarity, COUNT(*) as tokens, COUNT(DISTINCT creator_handle) as creators
    FROM token_map GROUP BY rarity
  `).all() as any[];

  console.log('\n' + '═'.repeat(72));
  console.log('  TOKEN MAP & CREATOR COVERAGE DIAGNOSTIC');
  console.log('═'.repeat(72));
  console.log(`  Seed JSON:`);
  console.log(`    Total creators:          ${seedCreators.length}`);
  console.log(`    With cards (supply > 0): ${seedWithCards.length}`);
  console.log(`    Expected card types:     ${expectedCardTypes} (creator+rarity combos)`);
  console.log(`  Token Map (SQLite):`);
  console.log(`    Mapped tokens:           ${tokenMapCount}`);
  console.log(`    Mapped creators:         ${tokenMapCreators}`);
  for (const r of mapByRarity) {
    console.log(`      ${r.rarity.padEnd(12)} ${r.tokens} tokens from ${r.creators} creators`);
  }
  console.log(`  Sale History:`);
  console.log(`    Creators with sales:     ${saleHandles.size}`);
  console.log(`    In sales but NOT in token_map: ${salesOnlyCreators.length}`);
  if (salesOnlyCreators.length > 0 && salesOnlyCreators.length <= 20) {
    for (const h of salesOnlyCreators) {
      console.log(`      - ${h}`);
    }
  }
  console.log(`  Coverage Gaps:`);
  console.log(`    Seed creators with cards but NO data: ${fullyMissing.length}`);
  if (fullyMissing.length > 0) {
    console.log(`    (first 10 missing):`);
    for (const c of fullyMissing.slice(0, 10)) {
      const total = (c.cards?.commonSupply ?? 0) + (c.cards?.rareSupply ?? 0) + (c.cards?.legendarySupply ?? 0);
      console.log(`      - ${c.xHandle} (${total} total supply)`);
    }
  }

  // Check if sale_history has creator_handle values not in seed (potential mapping issues)
  const unknownCreators = [...saleHandles].filter(h => !seedHandleSet.has(h));
  if (unknownCreators.length > 0) {
    console.log(`  WARNING: ${unknownCreators.length} creators in sales NOT in seed JSON:`);
    for (const h of unknownCreators.slice(0, 10)) {
      const count = (db.prepare('SELECT COUNT(*) as c FROM sale_history WHERE creator_handle = ?').get(h) as any).c;
      console.log(`      - ${h} (${count} sales)`);
    }
  }

  console.log('═'.repeat(72) + '\n');
}

db.close();
