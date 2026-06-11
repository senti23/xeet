// R1 derived — non-migrated creators
// Combines R0 (creator wallet migration status) + R1 (fresh MegaETH holdings) to identify:
//   (A) Creator's own wallet hasn't migrated yet  (per R0)
//   (B) Creator's cards have low/zero MegaETH presence (per holder count)
// Produces a unified list with both signals so we can sort either way.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

console.log('R1 — Non-migrated creator derivation\n');

// Load R0 creator wallet map
const creatorsMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'creators-wallet-map.json'), 'utf8'));
console.log(`Loaded creators-wallet-map: ${Object.keys(creatorsMap).length} creators`);

// Load Day 2 holders snapshot
const holders = JSON.parse(fs.readFileSync(path.join(__dirname, 'holders-snapshot.json'), 'utf8'));
console.log(`Loaded holders-snapshot (day 2): ${Object.keys(holders).length} wallets`);

// Load Abstract holder snapshot for cross-chain comparison
const absHolders = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'holder-snapshot.json'), 'utf8'));
console.log(`Loaded ABS holder-snapshot: ${Object.keys(absHolders).length} wallets`);

// Build creator → total cards on each chain
const megaCardsByCreator = {};
for (const wallet of Object.values(holders)) {
  for (const h of wallet) {
    if (!h.creator) continue;
    megaCardsByCreator[h.creator] = (megaCardsByCreator[h.creator] || 0) + h.qty;
  }
}

const absCardsByCreator = {};
for (const wallet of Object.values(absHolders)) {
  for (const h of wallet) {
    if (!h.creator) continue;
    absCardsByCreator[h.creator] = (absCardsByCreator[h.creator] || 0) + h.quantity;
  }
}

// Normalize handle case for matching
const lc = s => (s || '').toLowerCase();
const creatorsByLcHandle = {};
for (const handle of Object.keys(creatorsMap)) creatorsByLcHandle[lc(handle)] = handle;

// Map ABS/Mega card creator handles to canonical creator handle from creatorsMap
function canonicalHandle(h) {
  return creatorsByLcHandle[lc(h)] || h;
}

// Build unified per-creator view
const derived = {};
for (const handle of Object.keys(creatorsMap)) {
  const r0 = creatorsMap[handle];
  const lch = lc(handle);
  // Find matching mega + abs counts by case-insensitive handle
  const megaCount = (megaCardsByCreator[handle] || megaCardsByCreator[lch] || 0);
  const absCount = (absCardsByCreator[handle] || absCardsByCreator[lch] || 0);
  // Try a few common variants
  const lookup = Object.keys(megaCardsByCreator).find(k => lc(k) === lch);
  const lookupAbs = Object.keys(absCardsByCreator).find(k => lc(k) === lch);
  const megaCards = lookup ? megaCardsByCreator[lookup] : 0;
  const absCards = lookupAbs ? absCardsByCreator[lookupAbs] : 0;
  const total = megaCards + absCards;
  derived[handle] = {
    handle,
    displayName: r0.displayName,
    abs_wallets: r0.abs_wallets,
    megaeth_wallets: r0.megaeth_wallets,
    creator_wallet_migration_status: r0.migration_status,  // (A)
    mega_cards_in_circulation: megaCards,                    // (B) supply on MegaETH
    abs_cards_in_circulation: absCards,
    total_cards_in_circulation: total,
    mega_share: total > 0 ? +(megaCards / total).toFixed(3) : 0,
  };
}

// Categorize
const categories = {
  creator_not_migrated_and_zero_mega_presence: [],
  creator_not_migrated_but_cards_have_mega_presence: [],
  creator_migrated_but_cards_mostly_abs: [],
  fully_migrated_and_circulation_mega_dominant: [],
  partial: [],
};
for (const c of Object.values(derived)) {
  const a = c.creator_wallet_migration_status;
  const megaShare = c.mega_share;
  if (a === 'not_migrated' && c.mega_cards_in_circulation === 0) {
    categories.creator_not_migrated_and_zero_mega_presence.push(c);
  } else if (a === 'not_migrated' && c.mega_cards_in_circulation > 0) {
    categories.creator_not_migrated_but_cards_have_mega_presence.push(c);
  } else if (a === 'fully_migrated' && megaShare < 0.5) {
    categories.creator_migrated_but_cards_mostly_abs.push(c);
  } else if (a === 'fully_migrated' && megaShare >= 0.5) {
    categories.fully_migrated_and_circulation_mega_dominant.push(c);
  } else {
    categories.partial.push(c);
  }
}

console.log('\n--- Category breakdown ---');
for (const [k, arr] of Object.entries(categories)) {
  console.log(`  ${k.padEnd(54)} ${arr.length}`);
}

// Build the focused "non-migrated" outputs
const nonMigratedFocus = {
  // Definition A: creator's own wallet has not initiated any migration
  creators_with_unmigrated_wallets: Object.values(derived)
    .filter(c => c.creator_wallet_migration_status === 'not_migrated')
    .sort((a, b) => b.total_cards_in_circulation - a.total_cards_in_circulation)
    .map(c => ({ handle: c.handle, displayName: c.displayName, abs_cards: c.abs_cards_in_circulation, mega_cards: c.mega_cards_in_circulation, total: c.total_cards_in_circulation })),

  // Definition B: cards mostly remain on Abstract (regardless of creator wallet migration)
  cards_predominantly_abstract: Object.values(derived)
    .filter(c => c.total_cards_in_circulation > 0 && c.mega_share < 0.5)
    .sort((a, b) => a.mega_share - b.mega_share)
    .map(c => ({ handle: c.handle, displayName: c.displayName, abs_cards: c.abs_cards_in_circulation, mega_cards: c.mega_cards_in_circulation, mega_share: c.mega_share })),

  category_counts: Object.fromEntries(
    Object.entries(categories).map(([k, arr]) => [k, arr.length])
  ),
};

console.log('\n--- Definition A: Creators with unmigrated own-wallets ---');
console.log(`  count: ${nonMigratedFocus.creators_with_unmigrated_wallets.length}`);
console.log('  top 10 by total cards in circulation:');
for (const c of nonMigratedFocus.creators_with_unmigrated_wallets.slice(0, 10)) {
  console.log(`    ${c.handle.padEnd(22)} ABS=${String(c.abs_cards).padStart(4)}  Mega=${String(c.mega_cards).padStart(4)}  Total=${c.total}`);
}

console.log('\n--- Definition B: Cards mostly on Abstract (mega_share < 50%) ---');
console.log(`  count: ${nonMigratedFocus.cards_predominantly_abstract.length}`);
console.log('  top 10 most-stuck-on-abstract (by lowest mega_share):');
for (const c of nonMigratedFocus.cards_predominantly_abstract.slice(0, 10)) {
  console.log(`    ${c.handle.padEnd(22)} mega_share=${(c.mega_share*100).toFixed(1)}%  (ABS=${c.abs_cards}, Mega=${c.mega_cards})`);
}

// Write outputs
const fullPath = path.join(__dirname, 'creator-migration-state.json');
fs.writeFileSync(fullPath, JSON.stringify(derived, null, 2));
console.log(`\nWrote ${fullPath} (${(fs.statSync(fullPath).size/1024).toFixed(1)} KB) — full per-creator state`);

const focusPath = path.join(__dirname, 'non-migrated-creators.json');
fs.writeFileSync(focusPath, JSON.stringify(nonMigratedFocus, null, 2));
console.log(`Wrote ${focusPath} (${(fs.statSync(focusPath).size/1024).toFixed(1)} KB) — focused unmigrated lists`);
