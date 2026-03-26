/**
 * test-missing.ts — Test the computeMissing() function against Senti's wallet.
 *
 * Usage: cd server && npx tsx scripts/test-missing.ts
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { computeMissing } from '../src/services/deck-missing.js';
import type { WalletDetail, CreatorHoldingsMap } from '../src/services/deck-missing.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// Load data files
const detailData: Record<string, WalletDetail> = JSON.parse(
  readFileSync(resolve(ROOT, 'web/public/data/deck-scores-detail.json'), 'utf-8'),
);
const creatorHoldings: CreatorHoldingsMap = JSON.parse(
  readFileSync(resolve(ROOT, 'creator-holdings.json'), 'utf-8'),
);
const creatorsRaw: Array<{ xHandle: string; displayName: string }> = JSON.parse(
  readFileSync(resolve(ROOT, 'xeet-creators-full.json'), 'utf-8'),
);
const allCreators = creatorsRaw.map(c => ({ handle: c.xHandle, displayName: c.displayName }));

// Test wallet: Senti
const SENTI_WALLET = '0xc065666a1c3a05b81e8e36009332253c73dc769b';
const walletDetail = detailData[SENTI_WALLET];

if (!walletDetail) {
  console.error('Senti wallet not found in detail data');
  process.exit(1);
}

console.log(`\n══════════════════════════════════════════════════`);
console.log(`  MISSING CREATORS REPORT — Senti's Wallet`);
console.log(`══════════════════════════════════════════════════\n`);
console.log(`Direct holdings: ${walletDetail.direct.length}`);
console.log(`Secondary reach: ${Object.keys(walletDetail.secondary).length}`);
console.log(`Total reach: ${walletDetail.direct.length + Object.keys(walletDetail.secondary).length}`);

const result = computeMissing(walletDetail, creatorHoldings, allCreators);

console.log(`\n──── Missing Creators: ${result.missingCount} / ${result.totalCreators} ────\n`);
for (const m of result.missing) {
  const topBridge = m.bridges[0];
  console.log(`  • ${m.displayName} (@${m.handle})${topBridge ? ` — best bridge: @${topBridge.xccHandle} (covers ${topBridge.otherMissingCovered + 1} missing)` : ' — NO bridge available'}`);
}

console.log(`\n──── Top 5 Bridge Suggestions ────\n`);
for (let i = 0; i < Math.min(5, result.topBridges.length); i++) {
  const b = result.topBridges[i];
  console.log(`  ${i + 1}. Buy @${b.xccHandle} (${b.xccDisplayName}) → covers ${b.coverageCount} missing creators`);
  console.log(`     Creators: ${b.missingCreatorsCovered.slice(0, 8).join(', ')}${b.missingCreatorsCovered.length > 8 ? ` ...+${b.missingCreatorsCovered.length - 8} more` : ''}`);
}

console.log(`\n──── Greedy Set Cover (minimum cards to reach 100%) ────\n`);
let coveredSoFar = 0;
for (let i = 0; i < result.greedySetCover.length; i++) {
  const b = result.greedySetCover[i];
  coveredSoFar += b.coverageCount;
  console.log(`  ${i + 1}. @${b.xccHandle} (${b.xccDisplayName}) → +${b.coverageCount} creators (cumulative: ${coveredSoFar}/${result.missingCount})`);
}

const remainingAfterCover = result.missingCount - coveredSoFar;
console.log(`\n──── Summary ────\n`);
console.log(`  Missing creators: ${result.missingCount}`);
console.log(`  Cards needed for full coverage: ${result.cardsToFull}`);
if (remainingAfterCover > 0) {
  console.log(`  ⚠ ${remainingAfterCover} creators are truly unreachable (no XCC holds their card)`);
}
console.log('');
