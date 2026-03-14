/**
 * Verify the dataset — shows top 20 most traded cards.
 *
 * Usage:
 *   npx tsx scripts/verify-dataset.ts          # both rankings
 *   npx tsx scripts/verify-dataset.ts volume    # by volume only
 *   npx tsx scripts/verify-dataset.ts sales     # by sale count only
 */

import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../xeet.db');

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
  console.log('└─────────────┴────────┴──────────┴─────────┘\n');
}

db.close();
