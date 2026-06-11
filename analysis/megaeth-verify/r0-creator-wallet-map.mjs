// R0 — Comprehensive ABS → MegaETH creator wallet map (all 391 creators)
// Sources (in order of priority):
//   1. xeet-creators-full.json    -> primary walletAddress per creator (391)
//   2. multi-wallet-creators.json -> additional wallets for multi-wallet subset
//   3. wallet-migrations.json     -> yesterday's 1037 (abs, mega) pairs
//   4. creator-holdings.json      -> cross-check (386 entries with wallet+holds)
// Output: analysis/megaeth-verify/creators-wallet-map.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

console.log('R0 — Building creator wallet map (391 creators)');
console.log('');

// Load primary source
const creatorsFull = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'xeet-creators-full.json'), 'utf8'));
console.log(`Loaded xeet-creators-full.json: ${creatorsFull.length} creators`);

// Load multi-wallet
const multiWallet = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'multi-wallet-creators.json'), 'utf8'));
console.log(`Loaded multi-wallet-creators.json: ${Object.keys(multiWallet).length} multi-wallet creators`);

// Load yesterday's wallet pairs
const walletMigrations = JSON.parse(fs.readFileSync(path.join(__dirname, 'wallet-migrations.json'), 'utf8'));
console.log(`Loaded wallet-migrations.json: ${walletMigrations.length} (abs → mega) pairs`);

// Index wallet migrations by ABS wallet
const absToMega = new Map();
for (const p of walletMigrations) {
  const abs = (p.abs_wallet || '').toLowerCase();
  const mega = (p.megaeth_wallet || '').toLowerCase();
  if (!absToMega.has(abs)) absToMega.set(abs, []);
  absToMega.get(abs).push({ megaeth_wallet: mega, total_cards_migrated: p.total_cards_migrated });
}
console.log(`ABS→MegaETH index: ${absToMega.size} distinct ABS wallets with migration history`);

// Cross-check source
const creatorHoldings = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'creator-holdings.json'), 'utf8'));
console.log(`Loaded creator-holdings.json: ${Object.keys(creatorHoldings).length} entries`);

// Build the map
const out = {};
let withWallet = 0;
let withoutWallet = 0;
let multiWalletApplied = 0;

for (const c of creatorsFull) {
  const handle = c.xHandle;
  const primaryWallet = (c.walletAddress || '').toLowerCase();
  const absWallets = new Set();
  if (primaryWallet) {
    absWallets.add(primaryWallet);
    withWallet++;
  } else {
    withoutWallet++;
  }

  // Add multi-wallet alts if any (try both case-sensitive and lowercase lookup)
  const mw = multiWallet[handle] || multiWallet[handle.toLowerCase()] ||
             Object.values(multiWallet).find(v => v.primaryWallet?.toLowerCase() === primaryWallet);
  if (mw) {
    multiWalletApplied++;
    if (mw.primaryWallet) absWallets.add(mw.primaryWallet.toLowerCase());
    for (const a of (mw.additionalWallets || [])) {
      if (a.address) absWallets.add(a.address.toLowerCase());
    }
  }

  // Also cross-check with creator-holdings.json
  const ch = creatorHoldings[handle] || creatorHoldings[handle.toLowerCase()];
  if (ch && ch.wallet) absWallets.add(ch.wallet.toLowerCase());

  // Look up each ABS wallet's MegaETH counterpart
  const megaWallets = new Set();
  const walletDetails = [];
  for (const abs of absWallets) {
    const pairs = absToMega.get(abs) || [];
    for (const p of pairs) {
      megaWallets.add(p.megaeth_wallet);
      walletDetails.push({ abs, megaeth: p.megaeth_wallet, cards_migrated: p.total_cards_migrated });
    }
    if (pairs.length === 0) {
      walletDetails.push({ abs, megaeth: null, cards_migrated: 0 });
    }
  }

  // Determine migration status
  const absArr = [...absWallets];
  const migratedAbs = absArr.filter(a => absToMega.has(a));
  let migration_status;
  if (absArr.length === 0) {
    migration_status = 'no_wallet';
  } else if (migratedAbs.length === 0) {
    migration_status = 'not_migrated';
  } else if (migratedAbs.length === absArr.length) {
    migration_status = 'fully_migrated';
  } else {
    migration_status = 'partially_migrated';
  }

  out[handle] = {
    handle,
    displayName: c.displayName,
    abs_wallets: absArr,
    megaeth_wallets: [...megaWallets],
    wallet_pairs: walletDetails,
    migration_status,
    wallet_source: mw ? 'creators-full + multi-wallet' : (primaryWallet ? 'creators-full' : 'none'),
  };
}

console.log(`\nCreators with at least 1 ABS wallet:  ${withWallet}/${creatorsFull.length}`);
console.log(`Creators with NO wallet in source:    ${withoutWallet}`);
console.log(`Creators augmented from multi-wallet: ${multiWalletApplied}`);

// Aggregate counts by status
const statusCounts = {};
for (const c of Object.values(out)) {
  statusCounts[c.migration_status] = (statusCounts[c.migration_status] || 0) + 1;
}
console.log(`\nMigration status breakdown:`);
for (const [s, n] of Object.entries(statusCounts).sort((a,b) => b[1] - a[1])) {
  console.log(`  ${s.padEnd(22)} ${n} creators`);
}

// Validate Senti's known pair
console.log(`\nGround truth — Senti:`);
const sentiEntry = out['senti__23'] || Object.values(out).find(c => c.abs_wallets.includes('0xc065666a1c3a05b81e8e36009332253c73dc769b'));
if (sentiEntry) {
  console.log(`  handle: ${sentiEntry.handle}, status: ${sentiEntry.migration_status}`);
  console.log(`  ABS wallets:`, sentiEntry.abs_wallets);
  console.log(`  MegaETH wallets:`, sentiEntry.megaeth_wallets);
} else {
  console.log('  NOT FOUND — investigate');
}

// Write outputs
const mapPath = path.join(__dirname, 'creators-wallet-map.json');
fs.writeFileSync(mapPath, JSON.stringify(out, null, 2));
console.log(`\nWrote ${mapPath} (${(fs.statSync(mapPath).size / 1024).toFixed(1)} KB)`);

// Also write a short summary
const summary = {
  test: 'R0 — Comprehensive creator wallet mapping',
  total_creators: creatorsFull.length,
  creators_with_wallet: withWallet,
  creators_without_wallet: withoutWallet,
  multi_wallet_creators_applied: multiWalletApplied,
  status_breakdown: statusCounts,
  senti_resolved: !!sentiEntry,
};
fs.writeFileSync(path.join(__dirname, 'r0-summary.json'), JSON.stringify(summary, null, 2));
console.log('\nDone.');
