// M6 — Remap creator wallets from Abstract (AGW) to MegaETH addresses.
// XCC identity is keyed on xeet-creators-full.json walletAddress (deck-refresh.ts:206,
// compute-deck-scores.ts). Post-swap those must be the MegaETH wallets or every XCC
// shows zero holdings and secondary reach collapses.
//
// Rules (from the approved Phase 2 plan):
//   - exactly one mega wallet            → walletAddress = that wallet
//   - multiple mega wallets              → primary = most cards in fresh snapshot,
//                                          rest become multi-wallet additionalWallets
//   - no mega wallet (not migrated etc.) → keep the existing ABS wallet (renders empty
//                                          on a mega-only tracker — Senti signed off)
// Writes .bak backups of both files and prints a full change summary for review.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const creatorsPath = path.join(REPO_ROOT, 'xeet-creators-full.json');
const multiWalletPath = path.join(REPO_ROOT, 'multi-wallet-creators.json');
const creatorsFull = read(creatorsPath);
const oldMultiWallet = read(multiWalletPath);
const walletMap = read(path.join(__dirname, 'creators-wallet-map.json'));
const snapshot = read(path.join(__dirname, 'holders-snapshot.json'));

const confirm = process.argv.includes('--confirm');

const megaCardsByWallet = new Map();
const megaHoldingsByWallet = new Map();
for (const [w, hs] of Object.entries(snapshot)) {
  const lw = w.toLowerCase();
  megaCardsByWallet.set(lw, hs.reduce((s, h) => s + h.qty, 0));
  megaHoldingsByWallet.set(lw, hs);
}

const changes = [];
const kept = [];
const newMultiWallet = {};
const megaWalletOwners = new Map(); // collision check

for (const c of creatorsFull) {
  const handle = (c.xHandle || '').toLowerCase();
  const entry = walletMap[handle];
  if (!entry || entry.megaeth_wallets.length === 0) {
    kept.push({ handle, reason: entry ? entry.migration_status : 'not_in_map', wallet: c.walletAddress });
    continue;
  }

  // Rank mega wallets by live card count (snapshot)
  const ranked = [...entry.megaeth_wallets]
    .map((w) => ({ wallet: w.toLowerCase(), cards: megaCardsByWallet.get(w.toLowerCase()) || 0 }))
    .sort((a, b) => b.cards - a.cards);

  const primary = ranked[0];
  for (const r of ranked) {
    if (megaWalletOwners.has(r.wallet) && megaWalletOwners.get(r.wallet) !== handle) {
      console.warn(`COLLISION: mega wallet ${r.wallet} claimed by both ${megaWalletOwners.get(r.wallet)} and ${handle}`);
    }
    megaWalletOwners.set(r.wallet, handle);
  }

  if (c.walletAddress.toLowerCase() !== primary.wallet) {
    changes.push({ handle, old: c.walletAddress, new: primary.wallet, mega_cards: primary.cards });
    c.walletAddress = primary.wallet;
  }

  // Extra mega wallets with cards → multi-wallet entry (mirrors the existing file's shape)
  const extras = ranked.slice(1).filter((r) => r.cards > 0);
  if (extras.length > 0) {
    newMultiWallet[c.xHandle] = {
      primaryWallet: primary.wallet,
      additionalWallets: extras.map((r) => {
        const holdings = (megaHoldingsByWallet.get(r.wallet) || []).map((h) => ({
          creator: h.creator,
          rarity: h.rarity,
          quantity: h.qty,
        }));
        return {
          address: r.wallet,
          source: 'megaeth-migration',
          cards: r.cards,
          uniqueCreators: new Set(holdings.map((h) => h.creator)).size,
          holdings,
        };
      }),
    };
  }
}

const purgedMultiWallet = Object.keys(oldMultiWallet).filter((h) => !newMultiWallet[h]);

console.log(`creators remapped to a mega wallet: ${changes.length}`);
console.log(`creators keeping their ABS wallet:  ${kept.length}`);
console.log(`multi-wallet entries: ${Object.keys(oldMultiWallet).length} old → ${Object.keys(newMultiWallet).length} new (purged: ${purgedMultiWallet.join(', ') || 'none'})`);
console.log('\nRemap diff (handle: old → new [mega cards]):');
for (const ch of changes) console.log(`  ${ch.handle}: ${ch.old} → ${ch.new} [${ch.mega_cards}]`);
console.log('\nKept (no mega wallet):');
for (const k of kept) console.log(`  ${k.handle} (${k.reason})`);

if (!confirm) {
  console.log('\nDry run — pass --confirm to write files (with .bak backups).');
  process.exit(0);
}

fs.copyFileSync(creatorsPath, creatorsPath + '.bak');
fs.copyFileSync(multiWalletPath, multiWalletPath + '.bak');
fs.writeFileSync(creatorsPath, JSON.stringify(creatorsFull, null, 2));
fs.writeFileSync(multiWalletPath, JSON.stringify(newMultiWallet, null, 2));
fs.writeFileSync(path.join(__dirname, 'm6-remap-summary.json'), JSON.stringify({
  generated: new Date().toISOString(),
  remapped: changes.length,
  kept_abs: kept.length,
  multi_wallet_new: Object.keys(newMultiWallet).length,
  multi_wallet_purged: purgedMultiWallet,
  changes,
  kept,
}, null, 2));
console.log(`\nWrote ${creatorsPath} (+.bak), ${multiWalletPath} (+.bak), m6-remap-summary.json`);
