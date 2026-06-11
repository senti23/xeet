// M4 — Regenerate creators-wallet-map.json with migration_status derived from LIVE BALANCES,
// not bridge events (SESSION_LEARNINGS §5). Replaces r0 + r1.
// Inputs: xeet-creators-full.json, multi-wallet-creators.json, creator-holdings.json (wallet universe),
//         wallet-migrations.json (event history, secondary), abs-residual-holdings.json (LIVE ABS),
//         holders-snapshot.json (LIVE mega).
// Outputs: creators-wallet-map.json, still-on-abstract.json, m4-summary.json.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const creatorsFull = read(path.join(REPO_ROOT, 'xeet-creators-full.json'));
const multiWallet = read(path.join(REPO_ROOT, 'multi-wallet-creators.json'));
const creatorHoldings = read(path.join(REPO_ROOT, 'creator-holdings.json'));
const migrations = read(path.join(__dirname, 'wallet-migrations.json'));
const absResiduals = read(path.join(__dirname, 'abs-residual-holdings.json'));
const megaSnapshot = read(path.join(__dirname, 'holders-snapshot.json'));

if (absResiduals.summary.error_count > 0) {
  console.error(`abs-residual-holdings.json has ${absResiduals.summary.error_count} errored wallets — rerun m3 before m4.`);
  process.exit(1);
}

// Per-wallet card totals
const absCardsByWallet = new Map(); // LIVE abs balances
for (const [w, rec] of Object.entries(absResiduals.wallets)) {
  absCardsByWallet.set(w, rec.holdings.reduce((s, h) => s + h.qty, 0));
}
const megaCardsByWallet = new Map(); // LIVE mega balances
for (const [w, hs] of Object.entries(megaSnapshot)) {
  megaCardsByWallet.set(w.toLowerCase(), hs.reduce((s, h) => s + h.qty, 0));
}

// Migration pairs indexed by abs wallet
const pairsByAbs = new Map();
for (const m of migrations) {
  const k = m.abs_wallet.toLowerCase();
  if (!pairsByAbs.has(k)) pairsByAbs.set(k, []);
  pairsByAbs.get(k).push(m);
}

const handleLower = (h) => (h || '').toLowerCase();
const map = {};
const statusCounts = {};

for (const c of creatorsFull) {
  const handle = handleLower(c.xHandle);

  // ABS wallet universe (same union logic as m3)
  const absWallets = new Set();
  if (c.walletAddress) absWallets.add(c.walletAddress.toLowerCase());
  const mwKey = Object.keys(multiWallet).find(k => handleLower(k) === handle);
  let walletSource = 'creators-full';
  if (mwKey) {
    walletSource = 'creators-full + multi-wallet';
    if (multiWallet[mwKey].primaryWallet) absWallets.add(multiWallet[mwKey].primaryWallet.toLowerCase());
    for (const aw of multiWallet[mwKey].additionalWallets || []) absWallets.add(aw.address.toLowerCase());
  }
  const chKey = Object.keys(creatorHoldings).find(k => handleLower(k) === handle);
  if (chKey && creatorHoldings[chKey].wallet) absWallets.add(creatorHoldings[chKey].wallet.toLowerCase());

  // Mega wallets: migration destinations + any ABS-universe wallet holding directly on mega (same-address case)
  const megaWallets = new Set();
  const walletPairs = [];
  for (const aw of absWallets) {
    for (const m of pairsByAbs.get(aw) || []) {
      megaWallets.add(m.megaeth_wallet.toLowerCase());
      walletPairs.push({ abs: aw, megaeth: m.megaeth_wallet.toLowerCase(), cards_migrated: m.total_cards_migrated });
    }
    if (megaCardsByWallet.has(aw)) megaWallets.add(aw);
  }

  // LIVE balances
  const absCards = [...absWallets].reduce((s, w) => s + (absCardsByWallet.get(w) || 0), 0);
  const megaCards = [...megaWallets].reduce((s, w) => s + (megaCardsByWallet.get(w) || 0), 0);

  // Balance-derived status (the ONE question this field answers: where do their cards sit today)
  let status;
  if (absWallets.size === 0) status = 'no_wallet';
  else if (absCards > 0 && megaCards > 0) status = 'partially_migrated';
  else if (absCards === 0 && megaCards > 0) status = 'fully_migrated';
  else if (absCards > 0 && megaCards === 0) status = 'not_migrated';
  else status = 'no_cards_either_chain';

  statusCounts[status] = (statusCounts[status] || 0) + 1;

  map[handle] = {
    handle,
    displayName: c.displayName,
    abs_wallets: [...absWallets],
    megaeth_wallets: [...megaWallets],
    wallet_pairs: walletPairs,
    abs_cards: absCards,
    mega_cards: megaCards,
    migration_status: status,
    has_bridge_events: walletPairs.length > 0,
    wallet_source: walletSource,
  };
}

// still-on-abstract list: anyone with live ABS cards
const stillOnAbs = Object.values(map)
  .filter(c => c.abs_cards > 0)
  .map(c => ({ handle: c.handle, displayName: c.displayName, abs_cards: c.abs_cards, mega_cards: c.mega_cards, abs_wallets: c.abs_wallets }))
  .sort((a, b) => b.abs_cards - a.abs_cards);

const KNOWN_RESIDUALS = ['carlitoswa_y', 'fogonpc', 'ndidi_gram', '0xkekov', 'gyokeres_eth'];
const knownCheck = KNOWN_RESIDUALS.map(h => {
  const c = map[h];
  return { handle: h, found: !!c, abs_cards: c?.abs_cards ?? null, mega_cards: c?.mega_cards ?? null, status: c?.migration_status ?? null };
});

fs.writeFileSync(path.join(__dirname, 'creators-wallet-map.json'), JSON.stringify(map, null, 2));
fs.writeFileSync(path.join(__dirname, 'still-on-abstract.json'), JSON.stringify({ generated: new Date().toISOString(), count: stillOnAbs.length, creators: stillOnAbs }, null, 2));

const summary = {
  generated: new Date().toISOString(),
  creators: creatorsFull.length,
  status_counts: statusCounts,
  still_on_abstract_count: stillOnAbs.length,
  total_abs_residual_cards_xcc_wallets: stillOnAbs.reduce((s, c) => s + c.abs_cards, 0),
  known_residuals_check: knownCheck,
  senti_check: { status: map['senti__23']?.migration_status, abs: map['senti__23']?.abs_cards, mega: map['senti__23']?.mega_cards },
};
fs.writeFileSync(path.join(__dirname, 'm4-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log('\nTop 15 still on Abstract:');
for (const c of stillOnAbs.slice(0, 15)) console.log(`  ${c.handle}: ABS ${c.abs_cards} / MEGA ${c.mega_cards}`);
