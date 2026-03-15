/**
 * Verify backfill completeness — checks every creator across both marketplaces.
 *
 * Usage:
 *   npx tsx scripts/verify-backfill.ts           # full report
 *   npx tsx scripts/verify-backfill.ts --gaps     # only show creators with missing data
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../../xeet.db');
const CREATORS_JSON = resolve(__dirname, '../../xeet-creators-full.json');

const db = new Database(DB_PATH, { readonly: true });
const gapsOnly = process.argv.includes('--gaps');

// ── A. Database health ──
console.log('\n' + '═'.repeat(72));
console.log('  A. DATABASE HEALTH');
console.log('═'.repeat(72));

const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(r => r.name);
const requiredTables = ['token_map', 'bot_users', 'invite_codes', 'subscriptions', 'alert_history', 'sale_history'];
let allTablesOk = true;
for (const t of requiredTables) {
  const ok = tables.includes(t);
  if (!ok) allTablesOk = false;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} table ${t}`);
}

if (!tables.includes('sale_history')) {
  console.log('\n  FATAL: sale_history table missing. Run the server or collector once to create it.');
  console.log('         cd server && npx tsx -e "import { getDb } from \'./src/db/index.js\'; getDb();"');
  db.close();
  process.exit(1);
}

const tokenMapCount = (db.prepare('SELECT COUNT(*) as c FROM token_map').get() as any).c;
const tokenMapCreators = (db.prepare('SELECT COUNT(DISTINCT creator_handle) as c FROM token_map').get() as any).c;
console.log(`  Token map: ${tokenMapCount} tokens, ${tokenMapCreators} creators`);
console.log(`  ${tokenMapCount >= 976 ? 'PASS' : 'WARN'} expected 976+ tokens`);

// ── Load seed ──
let seedCreators: Array<{
  xHandle: string;
  displayName?: string;
  cards?: { commonSupply: number; rareSupply: number; legendarySupply: number };
}> = [];
try {
  seedCreators = JSON.parse(readFileSync(CREATORS_JSON, 'utf-8'));
} catch {
  console.log('  FAIL: Could not load xeet-creators-full.json');
  db.close();
  process.exit(1);
}
console.log(`  Seed JSON: ${seedCreators.length} creators`);

// ── B. Per-creator coverage ──
console.log('\n' + '═'.repeat(72));
console.log('  B. PER-CREATOR COVERAGE');
console.log('═'.repeat(72));

type Rarity = 'common' | 'rare' | 'legendary';

interface CreatorCoverage {
  handle: string;
  rarity: Rarity;
  expectedSupply: number;
  mappedTokens: number;
  xeetSales: number;
  xeetVolume: number;
  osSales: number;
  osVolume: number;
}

const getTokenCount = db.prepare(
  'SELECT COUNT(*) as c FROM token_map WHERE creator_handle = ? AND rarity = ?',
);
const getXeetSales = db.prepare(`
  SELECT COUNT(*) as sales, COALESCE(SUM(price), 0) as volume
  FROM sale_history WHERE creator_handle = ? AND rarity = ? AND marketplace = 'xeet'
`);
const getOsSales = db.prepare(`
  SELECT COUNT(*) as sales, COALESCE(SUM(price), 0) as volume
  FROM sale_history WHERE creator_handle = ? AND rarity = ? AND marketplace = 'opensea'
`);

const allCoverage: CreatorCoverage[] = [];
let creatorsWithNoData = 0;
let creatorsWithNoXeet = 0;
let creatorsWithNoOs = 0;
let creatorsWithNoTokens = 0;
let totalExpectedCardTypes = 0;

for (const c of seedCreators) {
  const handle = c.xHandle.toLowerCase();
  const supplies: [Rarity, number][] = [
    ['common', c.cards?.commonSupply ?? 0],
    ['rare', c.cards?.rareSupply ?? 0],
    ['legendary', c.cards?.legendarySupply ?? 0],
  ];

  for (const [rarity, supply] of supplies) {
    if (supply === 0) continue;
    totalExpectedCardTypes++;

    const tokens = (getTokenCount.get(handle, rarity) as any).c;
    const xeet = getXeetSales.get(handle, rarity) as any;
    const os = getOsSales.get(handle, rarity) as any;

    const entry: CreatorCoverage = {
      handle,
      rarity,
      expectedSupply: supply,
      mappedTokens: tokens,
      xeetSales: xeet.sales,
      xeetVolume: Math.round(xeet.volume * 100) / 100,
      osSales: os.sales,
      osVolume: Math.round(os.volume * 1e6) / 1e6,
    };
    allCoverage.push(entry);

    if (tokens === 0) creatorsWithNoTokens++;
    if (xeet.sales === 0 && os.sales === 0) creatorsWithNoData++;
    if (xeet.sales === 0) creatorsWithNoXeet++;
    if (os.sales === 0) creatorsWithNoOs++;
  }
}

console.log(`  Total card types (creator+rarity): ${totalExpectedCardTypes}`);
console.log(`  With mapped tokens:                ${totalExpectedCardTypes - creatorsWithNoTokens}`);
console.log(`  With zero mapped tokens:           ${creatorsWithNoTokens}`);
console.log(`  With zero data (no sales at all):   ${creatorsWithNoData}`);
console.log(`  With zero Xeet sales:              ${creatorsWithNoXeet}`);
console.log(`  With zero OpenSea sales:           ${creatorsWithNoOs}`);

// Show creators with gaps
const gaps = allCoverage.filter(c => c.mappedTokens === 0 || (c.xeetSales === 0 && c.osSales === 0));
if (gaps.length > 0) {
  console.log(`\n  CREATORS WITH GAPS (${gaps.length}):`);
  console.log('  ' + '-'.repeat(70));
  console.log('  Handle              Rarity     Tokens  Xeet Sales  OS Sales  Supply');
  console.log('  ' + '-'.repeat(70));
  for (const g of gaps) {
    const h = g.handle.padEnd(20);
    const r = g.rarity.padEnd(10);
    const t = String(g.mappedTokens).padStart(6);
    const xs = String(g.xeetSales).padStart(10);
    const os = String(g.osSales).padStart(8);
    const s = String(g.expectedSupply).padStart(7);
    console.log(`  ${h} ${r} ${t} ${xs} ${os} ${s}`);
  }
}

// ── C. Xeet marketplace totals ──
console.log('\n' + '═'.repeat(72));
console.log('  C. XEET MARKETPLACE TOTALS');
console.log('═'.repeat(72));

const xeetTotal = db.prepare(`
  SELECT COUNT(*) as sales, ROUND(SUM(price), 2) as volume
  FROM sale_history WHERE marketplace = 'xeet'
`).get() as any;
console.log(`  Total Xeet sales:  ${xeetTotal.sales}`);
console.log(`  Total Xeet volume: ${xeetTotal.volume ?? 0} XEETS`);

if (!gapsOnly) {
  const xeetTop = db.prepare(`
    SELECT creator_handle,
      COUNT(*) as sales,
      ROUND(SUM(price), 1) as volume
    FROM sale_history WHERE marketplace = 'xeet'
    GROUP BY creator_handle
    ORDER BY volume DESC
    LIMIT 30
  `).all() as any[];

  console.log('\n  Top 30 by Xeet volume (all rarities combined):');
  console.log('  ' + '-'.repeat(55));
  for (const [i, r] of xeetTop.entries()) {
    const num = String(i + 1).padStart(3);
    const h = r.creator_handle.padEnd(20);
    const v = String(r.volume).padStart(10);
    const s = String(r.sales).padStart(6);
    console.log(`  ${num}. ${h} ${v} XEETS  (${s} sales)`);
  }
}

// Creators with high supply but zero Xeet sales
const highSupplyNoXeet = allCoverage
  .filter(c => c.xeetSales === 0 && c.expectedSupply >= 50)
  .sort((a, b) => b.expectedSupply - a.expectedSupply);
if (highSupplyNoXeet.length > 0) {
  console.log(`\n  HIGH SUPPLY BUT ZERO XEET SALES (${highSupplyNoXeet.length}):`);
  for (const c of highSupplyNoXeet.slice(0, 15)) {
    console.log(`    ${c.handle.padEnd(20)} ${c.rarity.padEnd(10)} supply: ${c.expectedSupply}`);
  }
}

// ── D. OpenSea marketplace totals ──
console.log('\n' + '═'.repeat(72));
console.log('  D. OPENSEA MARKETPLACE TOTALS');
console.log('═'.repeat(72));

const osTotal = db.prepare(`
  SELECT COUNT(*) as sales, ROUND(SUM(price), 6) as volume
  FROM sale_history WHERE marketplace = 'opensea'
`).get() as any;
console.log(`  Total OS sales:  ${osTotal.sales}`);
console.log(`  Total OS volume: ${osTotal.volume ?? 0} ETH`);

if (!gapsOnly) {
  const osTop = db.prepare(`
    SELECT creator_handle,
      COUNT(*) as sales,
      ROUND(SUM(price), 6) as volume
    FROM sale_history WHERE marketplace = 'opensea'
    GROUP BY creator_handle
    ORDER BY volume DESC
    LIMIT 30
  `).all() as any[];

  console.log('\n  Top 30 by OpenSea volume (all rarities combined):');
  console.log('  ' + '-'.repeat(55));
  for (const [i, r] of osTop.entries()) {
    const num = String(i + 1).padStart(3);
    const h = r.creator_handle.padEnd(20);
    const v = String(r.volume).padStart(10);
    const s = String(r.sales).padStart(6);
    console.log(`  ${num}. ${h} ${v} ETH  (${s} sales)`);
  }
}

// ── E. Handle consistency ──
console.log('\n' + '═'.repeat(72));
console.log('  E. HANDLE CONSISTENCY');
console.log('═'.repeat(72));

const seedHandleSet = new Set(seedCreators.map(c => c.xHandle.toLowerCase()));
const saleHandles = (db.prepare('SELECT DISTINCT creator_handle FROM sale_history').all() as any[]).map(r => r.creator_handle);

const unknownInSales = saleHandles.filter(h => !seedHandleSet.has(h));
if (unknownInSales.length > 0) {
  console.log(`  WARN: ${unknownInSales.length} creators in sales NOT in seed JSON:`);
  for (const h of unknownInSales) {
    const count = (db.prepare('SELECT COUNT(*) as c FROM sale_history WHERE creator_handle = ?').get(h) as any).c;
    console.log(`    - ${h} (${count} sales)`);
  }
} else {
  console.log('  PASS: All creators in sales match seed JSON');
}

const seedWithCards = seedCreators.filter(c => {
  const total = (c.cards?.commonSupply ?? 0) + (c.cards?.rareSupply ?? 0) + (c.cards?.legendarySupply ?? 0);
  return total > 0;
});
const seedHandlesWithCards = new Set(seedWithCards.map(c => c.xHandle.toLowerCase()));
const saleHandleSet = new Set(saleHandles);
const fullyMissing = [...seedHandlesWithCards].filter(h => !saleHandleSet.has(h));
if (fullyMissing.length > 0) {
  console.log(`  WARN: ${fullyMissing.length} seed creators with cards but ZERO sales:`);
  for (const h of fullyMissing) {
    const c = seedCreators.find(s => s.xHandle.toLowerCase() === h);
    const total = (c?.cards?.commonSupply ?? 0) + (c?.cards?.rareSupply ?? 0) + (c?.cards?.legendarySupply ?? 0);
    console.log(`    - ${h} (${total} total supply)`);
  }
} else {
  console.log('  PASS: All seed creators with cards have at least one sale');
}

// ── Summary ──
console.log('\n' + '═'.repeat(72));
console.log('  SUMMARY');
console.log('═'.repeat(72));
const issues: string[] = [];
if (!allTablesOk) issues.push('Missing database tables');
if (creatorsWithNoTokens > 0) issues.push(`${creatorsWithNoTokens} card types with zero mapped tokens`);
if (creatorsWithNoData > 0) issues.push(`${creatorsWithNoData} card types with zero sales data`);
if (unknownInSales.length > 0) issues.push(`${unknownInSales.length} unknown handles in sales`);
if (fullyMissing.length > 0) issues.push(`${fullyMissing.length} seed creators completely missing`);

if (issues.length === 0) {
  console.log('  ALL CHECKS PASSED');
} else {
  console.log(`  ${issues.length} ISSUE(S) FOUND:`);
  for (const issue of issues) {
    console.log(`    - ${issue}`);
  }
}
console.log('═'.repeat(72) + '\n');

db.close();
