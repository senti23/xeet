/**
 * Detect XCC creators with multiple wallets by querying mvc-web API
 * and cross-referencing with our on-chain holder snapshot.
 *
 * Usage:
 *   npx tsx scripts/detect-multi-wallets.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const CREATORS_JSON = resolve(REPO_ROOT, 'xeet-creators-full.json');
const SNAPSHOT_JSON = resolve(REPO_ROOT, 'holder-snapshot.json');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Creator {
  xHandle: string;
  walletAddress: string;
  [key: string]: any;
}

interface HoldingEntry {
  creator: string;
  rarity: string;
  token_id: string;
  quantity: number;
}

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return null;
  return res.json();
}

async function main() {
  // Load data
  const creators: Creator[] = JSON.parse(readFileSync(CREATORS_JSON, 'utf-8'));
  const snapshot: Record<string, HoldingEntry[]> = JSON.parse(readFileSync(SNAPSHOT_JSON, 'utf-8'));

  console.log('Creators: %d', creators.length);
  console.log('Snapshot wallets: %d\n', Object.keys(snapshot).length);

  // Phase 1: Query mvc-web for each creator
  const multiWalletCreators: Record<string, {
    primaryWallet: string;
    additionalWallets: { address: string; source: string }[];
  }> = {};

  // Track all wallet -> handle mappings we discover
  const walletToHandle = new Map<string, string>();

  let notFound = 0;
  let singleWallet = 0;
  let multiWallet = 0;

  for (let i = 0; i < creators.length; i++) {
    const c = creators[i];
    const handle = c.xHandle;
    const primaryWallet = c.walletAddress.toLowerCase();

    if ((i + 1) % 50 === 0 || i < 3) {
      console.log('  Processing %d/%d: %s', i + 1, creators.length, handle);
    }

    // Dump full response for first 3
    const creatorData = await fetchJSON(`https://xeet.mvc-web.xyz/api/creators/${handle}`);
    await sleep(200);

    if (!creatorData) {
      notFound++;
      continue;
    }

    if (i < 3) {
      console.log('\n  === FULL RESPONSE: %s ===', handle);
      // Show top-level fields (not nested holdings)
      const { issuedCards, ...topLevel } = creatorData;
      console.log(JSON.stringify(topLevel, null, 2));
      console.log('  issuedCards: %d entries (omitted)\n', issuedCards?.length ?? 0);
    }

    // Collect all wallets from creator endpoint
    const discoveredWallets = new Set<string>();

    // The creator endpoint's walletAddress
    if (creatorData.walletAddress) {
      discoveredWallets.add(creatorData.walletAddress.toLowerCase());
    }

    // Check for any array fields containing wallets
    for (const key of Object.keys(creatorData)) {
      const val = creatorData[key];
      if (typeof val === 'string' && /^0x[a-fA-F0-9]{40}$/.test(val)) {
        discoveredWallets.add(val.toLowerCase());
      }
      if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string' && /^0x[a-fA-F0-9]{40}$/.test(item)) {
            discoveredWallets.add(item.toLowerCase());
          }
          // Check holdings for wallet addresses referencing the same handle
          if (item?.holdings) {
            for (const h of item.holdings) {
              if (h?.user?.walletAddress && h?.user?.xHandle?.toLowerCase() === handle.toLowerCase()) {
                discoveredWallets.add(h.user.walletAddress.toLowerCase());
              }
            }
          }
        }
      }
    }

    // Also scan issuedCards holdings for wallets with matching xHandle
    if (creatorData.issuedCards) {
      for (const card of creatorData.issuedCards) {
        if (card.holdings) {
          for (const h of card.holdings) {
            if (h?.user?.xHandle?.toLowerCase() === handle.toLowerCase()) {
              discoveredWallets.add(h.user.walletAddress.toLowerCase());
            }
          }
        }
      }
    }

    // Record all discovered wallets
    for (const w of discoveredWallets) {
      walletToHandle.set(w, handle);
    }

    // Check if there are additional wallets beyond primary
    const additional = [...discoveredWallets].filter(w => w !== primaryWallet);

    if (additional.length > 0) {
      multiWallet++;
      multiWalletCreators[handle] = {
        primaryWallet,
        additionalWallets: additional.map(a => ({ address: a, source: 'mvc-creator-holdings' })),
      };
    } else {
      singleWallet++;
    }
  }

  console.log('\n' + '═'.repeat(72));
  console.log('  PHASE 1 RESULTS (mvc-web /creators endpoint)');
  console.log('═'.repeat(72));
  console.log('  Single wallet: %d', singleWallet);
  console.log('  Multi wallet:  %d', multiWallet);
  console.log('  Not found:     %d', notFound);

  // Phase 2: For creators where we only found 1 wallet, try /users/{wallet}
  // The user endpoint might show holdings from other wallets with same xHandle
  console.log('\n  Phase 2: Checking /users/{wallet} for single-wallet creators...');

  let phase2Found = 0;
  const singleWalletCreators = creators.filter(c => {
    const handle = c.xHandle;
    return !multiWalletCreators[handle] && !(notFound > 0); // skip not-found
  });

  // Only check creators who have significant holdings (worth checking for alts)
  for (let i = 0; i < creators.length; i++) {
    const c = creators[i];
    const handle = c.xHandle;
    if (multiWalletCreators[handle]) continue; // already found multi

    const primaryWallet = c.walletAddress.toLowerCase();
    const primaryHoldings = snapshot[primaryWallet];
    const primaryCards = primaryHoldings ? primaryHoldings.reduce((s, h) => s + h.quantity, 0) : 0;

    // Skip creators we already found as multi-wallet
    // Query the users endpoint for their primary wallet
    if ((i + 1) % 50 === 0) {
      console.log('    Checking %d/%d...', i + 1, creators.length);
    }

    const userData = await fetchJSON(`https://xeet.mvc-web.xyz/api/users/${primaryWallet}`);
    await sleep(200);

    if (!userData) continue;

    // Check if userData references additional wallets with same xHandle
    // The holdings in user response show other holders with their wallets
    if (userData.holdings) {
      for (const h of userData.holdings) {
        if (h?.card?.holdings) {
          for (const holder of h.card.holdings) {
            if (holder?.user?.xHandle?.toLowerCase() === handle.toLowerCase() &&
                holder.user.walletAddress.toLowerCase() !== primaryWallet) {
              const altWallet = holder.user.walletAddress.toLowerCase();
              if (!multiWalletCreators[handle]) {
                multiWalletCreators[handle] = { primaryWallet, additionalWallets: [] };
                phase2Found++;
              }
              const existing = multiWalletCreators[handle].additionalWallets;
              if (!existing.find(e => e.address === altWallet)) {
                existing.push({ address: altWallet, source: 'mvc-user-holdings' });
              }
            }
          }
        }
      }
    }
  }

  console.log('  Phase 2 found %d additional multi-wallet creators', phase2Found);

  // Phase 3: Cross-reference with holder snapshot
  console.log('\n' + '═'.repeat(72));
  console.log('  MULTI-WALLET CREATORS');
  console.log('═'.repeat(72));

  const output: Record<string, any> = {};

  for (const [handle, data] of Object.entries(multiWalletCreators)) {
    const allWallets = [data.primaryWallet, ...data.additionalWallets.map(a => a.address)];

    // Get holdings from our snapshot for each wallet
    const walletHoldings: { address: string; cards: number; uniqueCreators: number; source: string }[] = [];

    let combinedCreators = new Set<string>();
    let combinedCards = 0;

    for (const w of allWallets) {
      const holdings = snapshot[w] || [];
      const cards = holdings.reduce((s, h) => s + h.quantity, 0);
      const unique = new Set(holdings.map(h => h.creator));
      const source = w === data.primaryWallet ? 'primary' :
        data.additionalWallets.find(a => a.address === w)?.source || 'unknown';

      walletHoldings.push({ address: w, cards, uniqueCreators: unique.size, source });
      combinedCards += cards;
      for (const c of unique) combinedCreators.add(c);
    }

    console.log('\n  %s (%d wallets, %d combined cards, %d unique creators):',
      handle, allWallets.length, combinedCards, combinedCreators.size);
    for (const wh of walletHoldings) {
      console.log('    %s  %d cards, %d creators  [%s]', wh.address, wh.cards, wh.uniqueCreators, wh.source);
    }

    output[handle] = {
      primaryWallet: data.primaryWallet,
      additionalWallets: data.additionalWallets.map(a => {
        const holdings = snapshot[a.address] || [];
        return {
          address: a.address,
          source: a.source,
          cards: holdings.reduce((s, h) => s + h.quantity, 0),
          uniqueCreators: new Set(holdings.map(h => h.creator)).size,
          holdings: holdings.map(h => ({ creator: h.creator, rarity: h.rarity, quantity: h.quantity })),
        };
      }),
      combinedCards,
      combinedUniqueCreators: combinedCreators.size,
    };
  }

  // Summary
  console.log('\n' + '═'.repeat(72));
  console.log('  SUMMARY');
  console.log('═'.repeat(72));
  console.log('  Total creators checked: %d', creators.length);
  console.log('  Multi-wallet creators: %d', Object.keys(multiWalletCreators).length);
  console.log('  Single-wallet creators: %d', creators.length - Object.keys(multiWalletCreators).length - notFound);
  console.log('  Not found on mvc-web: %d', notFound);

  // Write output
  const outPath = resolve(REPO_ROOT, 'multi-wallet-creators.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  console.log('\n  Wrote %s', outPath);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
