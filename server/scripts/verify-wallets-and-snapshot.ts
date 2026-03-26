/**
 * Two-phase script:
 *   Phase 1 — Verify creator wallets via on-chain rare card first-mints
 *   Phase 2 — Build fresh holder snapshot from all ERC-1155 transfers
 *
 * Usage:
 *   npx tsx scripts/verify-wallets-and-snapshot.ts           # both phases
 *   npx tsx scripts/verify-wallets-and-snapshot.ts --phase1   # wallet verify only
 *   npx tsx scripts/verify-wallets-and-snapshot.ts --phase2   # holder snapshot only
 */

import Database from 'better-sqlite3';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Find .env walking up from script location
function findEnvFile(): string | undefined {
  let dir = resolve(__dirname);
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, '.env');
    try { readFileSync(candidate); return candidate; } catch {}
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envPath = findEnvFile();
if (envPath) loadEnv({ path: envPath });

// --- Config ---

const ABSCAN_API_KEY = process.env.ABSCAN_API_KEY || '';
const ABSCAN_BASE = 'https://api.etherscan.io/v2/api';
const CHAIN_ID = '2741';
const CONTRACT = '0xeC27D2237432D06981e1F18581494661517E1bD3';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const DB_PATH = resolve(__dirname, '../../xeet.db');
const CREATORS_JSON = resolve(__dirname, '../../xeet-creators-full.json');
const REPO_ROOT = resolve(__dirname, '../..');

// --- Types ---

interface ERC1155Transfer {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  tokenID: string;
  tokenValue: string;
}

interface Creator {
  xHandle: string;
  displayName: string;
  walletAddress: string;
  cards: {
    commonSupply: number;
    rareSupply: number;
    legendarySupply: number;
    [key: string]: any;
  };
  [key: string]: any;
}

// --- Abscan fetch with rate limiting ---

let lastFetchTime = 0;
const MIN_DELAY_MS = 220; // ~4.5 req/sec, conservative for 5/sec limit

async function abscanFetch(params: Record<string, string>, label: string): Promise<any[] | null> {
  if (!ABSCAN_API_KEY) {
    console.error('FATAL: No ABSCAN_API_KEY in .env');
    process.exit(1);
  }

  const now = Date.now();
  const wait = MIN_DELAY_MS - (now - lastFetchTime);
  if (wait > 0) await sleep(wait);
  lastFetchTime = Date.now();

  const searchParams = new URLSearchParams({ chainid: CHAIN_ID, ...params, apikey: ABSCAN_API_KEY });
  const url = `${ABSCAN_BASE}?${searchParams}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (attempt < 3) { await sleep(1500 * attempt); continue; }
        throw new Error(`${label}: HTTP ${res.status}`);
      }
      const data = await res.json() as any;
      if (data.status === '0' && (data.message === 'No transactions found' || data.message === 'No records found')) {
        return null;
      }
      if (data.status === '0') {
        if (attempt < 3) { await sleep(1500 * attempt); continue; }
        throw new Error(`${label}: API error — ${data.message}`);
      }
      return data.result;
    } catch (err: any) {
      if (attempt < 3) { await sleep(1500 * attempt); continue; }
      throw err;
    }
  }
  return null;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Fetch ALL ERC-1155 transfers for the contract, paginating automatically.
 * Replicates abscan-client.ts getERC1155Transfers() logic.
 */
async function fetchAllTransfers(): Promise<ERC1155Transfer[]> {
  const PAGE_SIZE = 10000;
  const all: ERC1155Transfer[] = [];
  let currentStartBlock = 0;

  for (let batch = 1; ; batch++) {
    console.log(`  Fetching transfers page ${batch} (from block ${currentStartBlock})...`);
    const transfers = await abscanFetch(
      {
        module: 'account',
        action: 'token1155tx',
        contractaddress: CONTRACT,
        startblock: String(currentStartBlock),
        endblock: '99999999',
        page: '1',
        offset: String(PAGE_SIZE),
        sort: 'asc',
      },
      `batch-${batch}`,
    ) as ERC1155Transfer[] | null;

    if (!transfers || transfers.length === 0) break;
    all.push(...transfers);

    const lastBlock = parseInt(transfers[transfers.length - 1].blockNumber, 10);
    console.log(`    Got ${transfers.length} transfers (total: ${all.length}, lastBlock: ${lastBlock})`);

    if (transfers.length < PAGE_SIZE) break;
    currentStartBlock = lastBlock + 1;
  }

  return all;
}

// ════════════════════════════════════════════════════════════════════════
//  STEP 0: Prerequisites
// ════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const phase1Only = args.includes('--phase1');
  const phase2Only = args.includes('--phase2');
  const runPhase1 = !phase2Only;
  const runPhase2 = !phase1Only;

  console.log('\n' + '═'.repeat(72));
  console.log('  STEP 0: PREREQUISITES');
  console.log('═'.repeat(72));

  // Check API key
  if (!ABSCAN_API_KEY) {
    console.error('FATAL: ABSCAN_API_KEY not set in .env');
    process.exit(1);
  }
  console.log(`  Abscan API key: ${ABSCAN_API_KEY.slice(0, 8)}...`);

  // Check DB + token_map
  const db = new Database(DB_PATH);
  const tokenMapCount = (db.prepare('SELECT COUNT(*) as c FROM token_map').get() as any).c;
  console.log(`  token_map rows: ${tokenMapCount}`);
  if (tokenMapCount === 0) {
    console.error('FATAL: token_map is empty. Populate it first (run the server to trigger OpenSea sync).');
    db.close();
    process.exit(1);
  }

  // Load creators JSON
  const creators: Creator[] = JSON.parse(readFileSync(CREATORS_JSON, 'utf-8'));
  console.log(`  Creators in JSON: ${creators.length}`);

  // Load rare token_ids grouped by creator
  const rareRows = db.prepare(
    "SELECT token_id, creator_handle FROM token_map WHERE rarity = 'rare'"
  ).all() as { token_id: string; creator_handle: string }[];

  const creatorToRareTokens = new Map<string, string[]>();
  const rareTokenToCreator = new Map<string, string>();
  for (const row of rareRows) {
    const handle = row.creator_handle.toLowerCase();
    if (!creatorToRareTokens.has(handle)) creatorToRareTokens.set(handle, []);
    creatorToRareTokens.get(handle)!.push(row.token_id);
    rareTokenToCreator.set(row.token_id, handle);
  }
  console.log(`  Creators with rare tokens in token_map: ${creatorToRareTokens.size}`);
  console.log(`  Total rare token_ids: ${rareRows.length}`);

  // Load full token_map for Phase 2
  const allTokenRows = db.prepare(
    'SELECT token_id, creator_handle, rarity FROM token_map'
  ).all() as { token_id: string; creator_handle: string; rarity: string }[];
  const tokenMap = new Map<string, { handle: string; rarity: string }>();
  for (const row of allTokenRows) {
    tokenMap.set(row.token_id, { handle: row.creator_handle.toLowerCase(), rarity: row.rarity });
  }

  // ── Fetch all transfers (shared between phases) ──
  console.log('\n' + '═'.repeat(72));
  console.log('  FETCHING ALL ERC-1155 TRANSFERS');
  console.log('═'.repeat(72));
  const allTransfers = await fetchAllTransfers();
  console.log(`  Total transfers fetched: ${allTransfers.length}`);

  if (allTransfers.length === 0) {
    console.error('FATAL: No transfers returned from Abscan. Check API key and connectivity.');
    db.close();
    process.exit(1);
  }

  // ════════════════════════════════════════════════════════════════════
  //  PHASE 1: Creator Wallet Verification
  // ════════════════════════════════════════════════════════════════════

  // Build index: for each rare token_id, find first mint (from zero address, earliest block)
  const rareTokenIds = new Set(rareTokenToCreator.keys());
  // Map: token_id -> { to, blockNumber, timeStamp, hash }
  const firstMintByToken = new Map<string, { to: string; blockNumber: number; timeStamp: number; hash: string }>();

  for (const tx of allTransfers) {
    if (tx.from.toLowerCase() !== ZERO_ADDRESS) continue;
    if (!rareTokenIds.has(tx.tokenID)) continue;

    const blockNum = parseInt(tx.blockNumber, 10);
    const existing = firstMintByToken.get(tx.tokenID);
    if (!existing || blockNum < existing.blockNumber) {
      firstMintByToken.set(tx.tokenID, {
        to: tx.to.toLowerCase(),
        blockNumber: blockNum,
        timeStamp: parseInt(tx.timeStamp, 10),
        hash: tx.hash,
      });
    }
  }

  if (runPhase1) {
    console.log('\n' + '═'.repeat(72));
    console.log('  PHASE 1: CREATOR WALLET VERIFICATION');
    console.log('═'.repeat(72));

    // ── Step 1.3: Verify Senti__23 first ──
    console.log('\n  Step 1.3: Senti__23 verification...');
    const sentiHandle = 'senti__23';
    const sentiExpectedWallet = '0xc065666a1c3a05b81e8e36009332253c73dc769b';
    const sentiTokens = creatorToRareTokens.get(sentiHandle);

    if (!sentiTokens || sentiTokens.length === 0) {
      console.error('  FATAL: No rare token_ids found for senti__23 in token_map.');
      db.close();
      process.exit(1);
    }

    let sentiVerified = false;
    for (const tokenId of sentiTokens) {
      const mint = firstMintByToken.get(tokenId);
      if (!mint) {
        console.log(`    Token ${tokenId}: No mint found from zero address`);
        continue;
      }
      const mintDate = new Date(mint.timeStamp * 1000);
      const inRange = mintDate >= new Date('2026-02-11') && mintDate <= new Date('2026-03-01');
      const walletMatch = mint.to === sentiExpectedWallet;

      console.log(`    Token ${tokenId}:`);
      console.log(`      First mint to: ${mint.to}`);
      console.log(`      Expected:      ${sentiExpectedWallet}`);
      console.log(`      Match: ${walletMatch ? 'YES' : 'NO'}`);
      console.log(`      Mint date: ${mintDate.toISOString()} (in Feb 11-28 range: ${inRange ? 'YES' : 'NO'})`);
      console.log(`      Tx: ${mint.hash}`);

      if (walletMatch && inRange) sentiVerified = true;
    }

    if (!sentiVerified) {
      console.error('\n  FATAL: Senti__23 verification FAILED. Stopping before scale run.');
      db.close();
      process.exit(1);
    }
    console.log('  Senti__23 verification PASSED\n');

    // ── Step 1.4: Run for all creators ──
    console.log('  Step 1.4: Processing all creators...');

    // For each creator, find their wallet from the earliest rare first-mint
    const discoveredWallets = new Map<string, string>(); // handle -> wallet
    const noRareMint: string[] = [];

    for (const [handle, tokenIds] of creatorToRareTokens) {
      let earliest: { to: string; blockNumber: number } | null = null;
      for (const tokenId of tokenIds) {
        const mint = firstMintByToken.get(tokenId);
        if (!mint) continue;
        if (!earliest || mint.blockNumber < earliest.blockNumber) {
          earliest = mint;
        }
      }
      if (earliest) {
        discoveredWallets.set(handle, earliest.to);
      } else {
        noRareMint.push(handle);
      }
    }

    // Also track creators NOT in token_map at all
    const creatorsNotInTokenMap: string[] = [];
    for (const c of creators) {
      const handle = c.xHandle.toLowerCase();
      if (!creatorToRareTokens.has(handle) && (c.cards?.rareSupply ?? 0) > 0) {
        creatorsNotInTokenMap.push(handle);
      }
    }

    // ── Step 1.5: Compare with stored wallets ──
    console.log('  Step 1.5: Comparing with stored wallets...\n');

    const matches: string[] = [];
    const mismatches: { handle: string; stored: string; discovered: string }[] = [];
    const syntheticFixed: { handle: string; discovered: string }[] = [];

    const creatorMap = new Map(creators.map(c => [c.xHandle.toLowerCase(), c]));

    for (const [handle, discoveredWallet] of discoveredWallets) {
      const creator = creatorMap.get(handle);
      if (!creator) continue;

      const storedWallet = creator.walletAddress.toLowerCase();
      if (storedWallet === discoveredWallet) {
        matches.push(handle);
      } else if (storedWallet.includes('synthetic')) {
        syntheticFixed.push({ handle, discovered: discoveredWallet });
      } else {
        mismatches.push({ handle, stored: storedWallet, discovered: discoveredWallet });
      }
    }

    // ── Report ──
    console.log('═'.repeat(72));
    console.log('  PHASE 1 RESULTS');
    console.log('═'.repeat(72));
    console.log(`  Wallets matching stored value: ${matches.length}`);
    console.log(`  Mismatches (non-synthetic):    ${mismatches.length}`);
    console.log(`  Synthetic wallets discovered:  ${syntheticFixed.length}`);
    console.log(`  Creators with no rare mint:    ${noRareMint.length}`);
    console.log(`  Creators not in token_map:     ${creatorsNotInTokenMap.length}`);

    if (syntheticFixed.length > 0) {
      console.log('\n  SYNTHETIC WALLETS DISCOVERED:');
      for (const { handle, discovered } of syntheticFixed) {
        console.log(`    ${handle.padEnd(20)} → ${discovered}`);
      }
    }

    if (mismatches.length > 0) {
      console.log('\n  MISMATCHES (manual review needed):');
      for (const { handle, stored, discovered } of mismatches) {
        console.log(`    ${handle.padEnd(20)} stored: ${stored}`);
        console.log(`    ${''.padEnd(20)} found:  ${discovered}`);
      }
    }

    if (noRareMint.length > 0) {
      console.log(`\n  NO RARE MINT FOUND (${noRareMint.length}):`);
      for (const h of noRareMint.slice(0, 20)) console.log(`    - ${h}`);
      if (noRareMint.length > 20) console.log(`    ... and ${noRareMint.length - 20} more`);
    }

    if (creatorsNotInTokenMap.length > 0) {
      console.log(`\n  CREATORS WITH rareSupply>0 BUT NOT IN token_map (${creatorsNotInTokenMap.length}):`);
      for (const h of creatorsNotInTokenMap.slice(0, 20)) console.log(`    - ${h}`);
      if (creatorsNotInTokenMap.length > 20) console.log(`    ... and ${creatorsNotInTokenMap.length - 20} more`);
    }

    // ── Step 1.6: Update xeet-creators-full.json ──
    if (syntheticFixed.length > 0) {
      console.log('\n  Updating xeet-creators-full.json...');
      // Backup first
      const backupPath = CREATORS_JSON + '.bak';
      copyFileSync(CREATORS_JSON, backupPath);
      console.log(`  Backup saved: ${backupPath}`);

      for (const { handle, discovered } of syntheticFixed) {
        const creator = creators.find(c => c.xHandle.toLowerCase() === handle);
        if (creator) {
          console.log(`  Replacing ${handle}: ${creator.walletAddress} → ${discovered}`);
          creator.walletAddress = discovered;
        }
      }
      writeFileSync(CREATORS_JSON, JSON.stringify(creators, null, 2) + '\n');
      console.log('  xeet-creators-full.json updated.');
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  PHASE 2: Fresh Holder Snapshot
  // ════════════════════════════════════════════════════════════════════

  if (runPhase2) {
    console.log('\n' + '═'.repeat(72));
    console.log('  PHASE 2: HOLDER SNAPSHOT');
    console.log('═'.repeat(72));

    // ── Step 2.1: Reconstruct balances ──
    console.log('  Step 2.1: Reconstructing balances from transfers...');

    const balances = new Map<string, number>(); // "wallet:tokenId" -> quantity
    let highestBlock = 0;

    for (const tx of allTransfers) {
      const from = tx.from.toLowerCase();
      const to = tx.to.toLowerCase();
      const tokenId = tx.tokenID;
      const qty = parseInt(tx.tokenValue, 10) || 1;
      const block = parseInt(tx.blockNumber, 10);
      if (block > highestBlock) highestBlock = block;

      // Subtract from sender (skip zero address = mint)
      if (from !== ZERO_ADDRESS) {
        const key = `${from}:${tokenId}`;
        balances.set(key, (balances.get(key) ?? 0) - qty);
      }

      // Add to receiver (skip zero address = burn)
      if (to !== ZERO_ADDRESS) {
        const key = `${to}:${tokenId}`;
        balances.set(key, (balances.get(key) ?? 0) + qty);
      }
    }

    // Filter to positive balances with known token_ids
    const positiveHoldings: { wallet: string; tokenId: string; quantity: number; handle: string; rarity: string }[] = [];
    let unknownTokenCount = 0;

    for (const [key, qty] of balances) {
      if (qty <= 0) continue;
      const [wallet, tokenId] = key.split(':');
      const meta = tokenMap.get(tokenId);
      if (!meta) { unknownTokenCount++; continue; }
      positiveHoldings.push({ wallet, tokenId, quantity: qty, handle: meta.handle, rarity: meta.rarity });
    }

    console.log(`  Positive holdings: ${positiveHoldings.length}`);
    console.log(`  Unknown token_ids skipped: ${unknownTokenCount}`);
    console.log(`  Highest block: ${highestBlock}`);

    // ── Step 2.2: Write to card_holders table ──
    console.log('  Step 2.2: Writing to card_holders...');

    const writeDb = new Database(DB_PATH);
    const insertStmt = writeDb.prepare(`
      INSERT OR REPLACE INTO card_holders (wallet_address, token_id, quantity, creator_handle, rarity, last_updated)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    const upsertMeta = writeDb.prepare(`
      INSERT OR REPLACE INTO holder_sync_meta (key, value) VALUES (?, ?)
    `);

    const writeTx = writeDb.transaction(() => {
      writeDb.prepare('DELETE FROM card_holders').run();
      for (const h of positiveHoldings) {
        insertStmt.run(h.wallet, h.tokenId, h.quantity, h.handle, h.rarity);
      }
      upsertMeta.run('last_synced_block', String(highestBlock));
      upsertMeta.run('last_full_sync', new Date().toISOString());
    });
    writeTx();

    const holderCount = (writeDb.prepare('SELECT COUNT(DISTINCT wallet_address) as c FROM card_holders').get() as any).c;
    const totalRows = (writeDb.prepare('SELECT COUNT(*) as c FROM card_holders').get() as any).c;
    console.log(`  card_holders: ${totalRows} rows, ${holderCount} unique wallets`);
    writeDb.close();

    // ── Step 2.3: Generate reports and exports ──
    console.log('  Step 2.3: Generating reports and exports...');

    // Build structured data
    const walletHoldings = new Map<string, { creator: string; rarity: string; token_id: string; quantity: number }[]>();
    for (const h of positiveHoldings) {
      if (!walletHoldings.has(h.wallet)) walletHoldings.set(h.wallet, []);
      walletHoldings.get(h.wallet)!.push({ creator: h.handle, rarity: h.rarity, token_id: h.tokenId, quantity: h.quantity });
    }

    // Distribution
    const distBuckets = { '1': 0, '2-5': 0, '6-10': 0, '11-20': 0, '20+': 0 };
    for (const [, cards] of walletHoldings) {
      const total = cards.reduce((s, c) => s + c.quantity, 0);
      if (total === 1) distBuckets['1']++;
      else if (total <= 5) distBuckets['2-5']++;
      else if (total <= 10) distBuckets['6-10']++;
      else if (total <= 20) distBuckets['11-20']++;
      else distBuckets['20+']++;
    }

    // Top 20 by unique creators
    const walletCreatorCounts = [...walletHoldings.entries()]
      .map(([wallet, cards]) => ({
        wallet,
        uniqueCreators: new Set(cards.map(c => c.creator)).size,
        totalCards: cards.reduce((s, c) => s + c.quantity, 0),
      }))
      .sort((a, b) => b.uniqueCreators - a.uniqueCreators || b.totalCards - a.totalCards)
      .slice(0, 20);

    // Creator cross-holdings (reload creators JSON in case Phase 1 updated it)
    const updatedCreators: Creator[] = JSON.parse(readFileSync(CREATORS_JSON, 'utf-8'));
    const creatorWallets = new Map<string, string>();
    for (const c of updatedCreators) {
      creatorWallets.set(c.xHandle.toLowerCase(), c.walletAddress.toLowerCase());
    }

    const creatorHoldingsMap: Record<string, { wallet: string; holds: { creator: string; rarity: string; quantity: number }[] }> = {};
    for (const [handle, wallet] of creatorWallets) {
      const holdings = walletHoldings.get(wallet);
      if (!holdings) continue;
      creatorHoldingsMap[handle] = {
        wallet,
        holds: holdings.map(h => ({ creator: h.creator, rarity: h.rarity, quantity: h.quantity })),
      };
    }

    // Total cards
    const totalCards = positiveHoldings.reduce((s, h) => s + h.quantity, 0);

    // Unknown token_ids held
    const unknownTokenIds = new Set<string>();
    for (const [key, qty] of balances) {
      if (qty <= 0) continue;
      const tokenId = key.split(':')[1];
      if (!tokenMap.has(tokenId)) unknownTokenIds.add(tokenId);
    }

    // ── Write holder-snapshot-report.md ──
    const reportLines = [
      '# Holder Snapshot Report',
      `Generated: ${new Date().toISOString()}`,
      `Highest block: ${highestBlock}`,
      '',
      '## Summary',
      `- Total unique wallets: ${walletHoldings.size}`,
      `- Total cards held: ${totalCards}`,
      `- Total (wallet, token) pairs: ${positiveHoldings.length}`,
      '',
      '## Distribution (wallets by cards held)',
      `| Cards | Wallets |`,
      `|-------|---------|`,
      ...Object.entries(distBuckets).map(([k, v]) => `| ${k} | ${v} |`),
      '',
      '## Top 20 Wallets by Unique Creators',
      `| # | Wallet | Unique Creators | Total Cards |`,
      `|---|--------|-----------------|-------------|`,
      ...walletCreatorCounts.map((w, i) => `| ${i + 1} | ${w.wallet} | ${w.uniqueCreators} | ${w.totalCards} |`),
      '',
      `## XCC Creator Holdings (${Object.keys(creatorHoldingsMap).length} creators holding cards)`,
      '',
    ];

    // Sort creators by number of OTHER creators' cards held
    const creatorCrossHoldings = Object.entries(creatorHoldingsMap)
      .map(([handle, data]) => {
        const otherCreators = new Set(data.holds.filter(h => h.creator !== handle).map(h => h.creator));
        return { handle, wallet: data.wallet, otherCreatorsHeld: otherCreators.size, totalCards: data.holds.reduce((s, h) => s + h.quantity, 0) };
      })
      .sort((a, b) => b.otherCreatorsHeld - a.otherCreatorsHeld);

    reportLines.push(
      `| # | Creator | Other Creators Held | Total Cards |`,
      `|---|---------|---------------------|-------------|`,
      ...creatorCrossHoldings.slice(0, 50).map((c, i) =>
        `| ${i + 1} | ${c.handle} | ${c.otherCreatorsHeld} | ${c.totalCards} |`
      ),
    );

    if (unknownTokenIds.size > 0) {
      reportLines.push(
        '',
        `## Unknown Token IDs (${unknownTokenIds.size} not in token_map)`,
        ...([...unknownTokenIds].slice(0, 20).map(id => `- ${id}`)),
      );
    }

    writeFileSync(resolve(REPO_ROOT, 'holder-snapshot-report.md'), reportLines.join('\n') + '\n');
    console.log('  Wrote holder-snapshot-report.md');

    // ── Write holder-snapshot.json ──
    const snapshotObj: Record<string, { creator: string; rarity: string; token_id: string; quantity: number }[]> = {};
    for (const [wallet, cards] of walletHoldings) {
      snapshotObj[wallet] = cards;
    }
    writeFileSync(resolve(REPO_ROOT, 'holder-snapshot.json'), JSON.stringify(snapshotObj, null, 2) + '\n');
    console.log('  Wrote holder-snapshot.json');

    // ── Write creator-holdings.json ──
    writeFileSync(resolve(REPO_ROOT, 'creator-holdings.json'), JSON.stringify(creatorHoldingsMap, null, 2) + '\n');
    console.log('  Wrote creator-holdings.json');

    console.log('\n' + '═'.repeat(72));
    console.log('  PHASE 2 COMPLETE');
    console.log('═'.repeat(72));
    console.log(`  Unique wallets:  ${walletHoldings.size}`);
    console.log(`  Total cards:     ${totalCards}`);
    console.log(`  DB rows written: ${positiveHoldings.length}`);
  }

  db.close();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
