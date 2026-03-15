import { childLogger } from '../lib/logger.js';
import { getDb, getStmts } from '../db/index.js';
import { getCreatorRarity, type Rarity } from './token-map.js';
import * as abscanClient from './abscan-client.js';
import { getCache, type CreatorRarityData } from './data-pipeline.js';

const log = childLogger('holder-service');

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// --- Types ---

export interface DeckCard {
  tokenId: string;
  creatorHandle: string;
  rarity: Rarity;
  quantity: number;
  estimatedValueEth: number | null;
}

export interface DeckSummary {
  wallet: string;
  totalCards: number;
  uniqueCards: number;
  uniqueCreators: number;
  rarityBreakdown: { common: number; rare: number; legendary: number };
  estimatedPortfolioEth: number;
  cards: DeckCard[];
}

export interface WalletSummary {
  wallet: string;
  uniqueCards: number;
  totalCards: number;
  uniqueCreators: number;
  estimatedPortfolioEth: number;
}

export interface HolderInfo {
  wallet: string;
  quantity: number;
}

export interface BackfillResult {
  transfers: number;
  uniqueHolders: number;
  uniqueTokens: number;
  highestBlock: number;
}

// --- Status ---

let backfillRunning = false;
let backfillComplete = false;

export function getHolderSyncStatus(): {
  running: boolean;
  complete: boolean;
  lastSyncedBlock: string | null;
  lastFullSync: string | null;
  holderCount: number;
} {
  const stmts = getStmts();
  const blockRow = stmts.getSyncMeta.get('last_synced_block') as { value: string } | undefined;
  const syncRow = stmts.getSyncMeta.get('last_full_sync') as { value: string } | undefined;
  const countRow = stmts.getHolderCount.get() as { count: number };
  return {
    running: backfillRunning,
    complete: backfillComplete,
    lastSyncedBlock: blockRow?.value ?? null,
    lastFullSync: syncRow?.value ?? null,
    holderCount: countRow.count,
  };
}

// --- Backfill ---

/**
 * Full backfill: fetch ALL transfer events, reconstruct balances from scratch.
 */
export async function backfillHolders(): Promise<BackfillResult> {
  if (backfillRunning) {
    log.warn('Holder backfill already in progress');
    return { transfers: 0, uniqueHolders: 0, uniqueTokens: 0, highestBlock: 0 };
  }

  backfillRunning = true;
  log.info('Starting holder backfill from transfer events');

  try {
    // Check if we have a partial sync we can resume from
    const stmts = getStmts();
    const blockRow = stmts.getSyncMeta.get('last_synced_block') as { value: string } | undefined;
    const startBlock = blockRow ? parseInt(blockRow.value, 10) + 1 : 0;

    if (startBlock > 0) {
      log.info({ startBlock }, 'Resuming holder sync from last synced block');
    }

    const transfers = await abscanClient.getERC1155Transfers(startBlock);
    log.info({ count: transfers.length, startBlock }, 'Transfer events fetched');

    if (transfers.length === 0) {
      backfillComplete = true;
      backfillRunning = false;
      return { transfers: 0, uniqueHolders: 0, uniqueTokens: 0, highestBlock: startBlock };
    }

    // Build balance map from transfers
    // For a full backfill (startBlock=0), we reconstruct everything
    // For incremental, we adjust existing balances
    const isFullSync = startBlock === 0;

    if (isFullSync) {
      return processFullSync(transfers);
    } else {
      return processIncrementalSync(transfers);
    }
  } catch (err) {
    log.error({ err }, 'Holder backfill failed');
    throw err;
  } finally {
    backfillRunning = false;
  }
}

function processFullSync(transfers: abscanClient.ERC1155Transfer[]): BackfillResult {
  const balances = new Map<string, number>(); // "wallet:tokenId" → quantity
  let highestBlock = 0;

  for (const tx of transfers) {
    const tokenId = tx.tokenID;
    const qty = parseInt(tx.tokenValue, 10) || 1;
    const block = parseInt(tx.blockNumber, 10);
    if (block > highestBlock) highestBlock = block;

    const from = tx.from.toLowerCase();
    const to = tx.to.toLowerCase();

    // Subtract from sender (unless mint from zero address)
    if (from !== ZERO_ADDRESS) {
      const fromKey = `${from}:${tokenId}`;
      balances.set(fromKey, (balances.get(fromKey) ?? 0) - qty);
    }

    // Add to receiver (unless burn to zero address)
    if (to !== ZERO_ADDRESS) {
      const toKey = `${to}:${tokenId}`;
      balances.set(toKey, (balances.get(toKey) ?? 0) + qty);
    }
  }

  // Write to DB in a single transaction
  const db = getDb();
  const stmts = getStmts();
  const uniqueWallets = new Set<string>();
  const uniqueTokens = new Set<string>();

  db.transaction(() => {
    stmts.deleteAllHolders.run();

    for (const [key, qty] of balances) {
      if (qty <= 0) continue;
      const [wallet, tokenId] = key.split(':');
      const mapping = getCreatorRarity(tokenId);
      if (!mapping) continue; // unknown token, skip

      stmts.upsertHolder.run(wallet, tokenId, qty, mapping.handle.toLowerCase(), mapping.rarity);
      uniqueWallets.add(wallet);
      uniqueTokens.add(tokenId);
    }

    stmts.upsertSyncMeta.run('last_synced_block', String(highestBlock));
    stmts.upsertSyncMeta.run('last_full_sync', new Date().toISOString());
  })();

  const result = {
    transfers: transfers.length,
    uniqueHolders: uniqueWallets.size,
    uniqueTokens: uniqueTokens.size,
    highestBlock,
  };
  log.info(result, 'Full holder sync complete');
  backfillComplete = true;
  return result;
}

function processIncrementalSync(transfers: abscanClient.ERC1155Transfer[]): BackfillResult {
  const db = getDb();
  const stmts = getStmts();
  let highestBlock = 0;
  const touchedWallets = new Set<string>();
  const touchedTokens = new Set<string>();

  db.transaction(() => {
    for (const tx of transfers) {
      const tokenId = tx.tokenID;
      const qty = parseInt(tx.tokenValue, 10) || 1;
      const block = parseInt(tx.blockNumber, 10);
      if (block > highestBlock) highestBlock = block;

      const from = tx.from.toLowerCase();
      const to = tx.to.toLowerCase();
      const mapping = getCreatorRarity(tokenId);
      if (!mapping) continue;

      const handle = mapping.handle.toLowerCase();
      const rarity = mapping.rarity;

      // Decrement sender balance
      if (from !== ZERO_ADDRESS) {
        const existing = stmts.getHoldersByToken.all(tokenId) as Array<{ wallet_address: string; quantity: number }>;
        const senderRow = existing.find(r => r.wallet_address === from);
        const newQty = (senderRow?.quantity ?? 0) - qty;
        if (newQty > 0) {
          stmts.upsertHolder.run(from, tokenId, newQty, handle, rarity);
        } else {
          // Remove holder entirely
          db.prepare('DELETE FROM card_holders WHERE wallet_address = ? AND token_id = ?').run(from, tokenId);
        }
        touchedWallets.add(from);
      }

      // Increment receiver balance
      if (to !== ZERO_ADDRESS) {
        const existing = stmts.getHoldersByToken.all(tokenId) as Array<{ wallet_address: string; quantity: number }>;
        const receiverRow = existing.find(r => r.wallet_address === to);
        const newQty = (receiverRow?.quantity ?? 0) + qty;
        stmts.upsertHolder.run(to, tokenId, newQty, handle, rarity);
        touchedWallets.add(to);
      }

      touchedTokens.add(tokenId);
    }

    stmts.upsertSyncMeta.run('last_synced_block', String(highestBlock));
  })();

  const result = {
    transfers: transfers.length,
    uniqueHolders: touchedWallets.size,
    uniqueTokens: touchedTokens.size,
    highestBlock,
  };
  log.info(result, 'Incremental holder sync complete');
  backfillComplete = true;
  return result;
}

/**
 * Periodic refresh — fetch new transfers since last synced block.
 */
export async function refreshHolders(): Promise<void> {
  if (backfillRunning) {
    log.debug('Holder sync already running, skipping refresh');
    return;
  }

  const stmts = getStmts();
  const blockRow = stmts.getSyncMeta.get('last_synced_block') as { value: string } | undefined;
  if (!blockRow) {
    log.info('No previous holder sync — running full backfill');
    await backfillHolders();
    return;
  }

  const startBlock = parseInt(blockRow.value, 10) + 1;
  backfillRunning = true;

  try {
    const transfers = await abscanClient.getERC1155Transfers(startBlock);
    if (transfers.length === 0) {
      log.debug({ startBlock }, 'No new transfers since last sync');
      return;
    }

    processIncrementalSync(transfers);
  } catch (err) {
    log.error({ err }, 'Holder refresh failed');
  } finally {
    backfillRunning = false;
  }
}

// --- Query functions ---

function estimateCardValueEth(creatorHandle: string, rarity: string): number | null {
  const cache = getCache();
  const key = `${creatorHandle}:${rarity}`;
  const data = cache.data.get(key);
  if (!data) return null;

  // Priority: OS floor → last OS sale → null
  if (data.osFloor !== null && data.osFloor > 0) return data.osFloor;
  if (data.lastSaleOs !== null && data.lastSaleOs > 0) return data.lastSaleOs;
  return null;
}

export function getWalletDeck(wallet: string): DeckSummary | null {
  const stmts = getStmts();
  const rows = stmts.getHoldersByWallet.all(wallet.toLowerCase()) as Array<{
    wallet_address: string;
    token_id: string;
    quantity: number;
    creator_handle: string;
    rarity: string;
  }>;

  if (rows.length === 0) return null;

  const cards: DeckCard[] = [];
  const creators = new Set<string>();
  const rarityBreakdown = { common: 0, rare: 0, legendary: 0 };
  let totalCards = 0;
  let portfolioEth = 0;

  for (const row of rows) {
    const valueEth = estimateCardValueEth(row.creator_handle, row.rarity);
    cards.push({
      tokenId: row.token_id,
      creatorHandle: row.creator_handle,
      rarity: row.rarity as Rarity,
      quantity: row.quantity,
      estimatedValueEth: valueEth !== null ? valueEth * row.quantity : null,
    });
    creators.add(row.creator_handle);
    totalCards += row.quantity;
    if (row.rarity in rarityBreakdown) {
      rarityBreakdown[row.rarity as keyof typeof rarityBreakdown] += row.quantity;
    }
    if (valueEth !== null) portfolioEth += valueEth * row.quantity;
  }

  // Sort cards by estimated value descending (nulls last)
  cards.sort((a, b) => (b.estimatedValueEth ?? -1) - (a.estimatedValueEth ?? -1));

  return {
    wallet: wallet.toLowerCase(),
    totalCards,
    uniqueCards: rows.length,
    uniqueCreators: creators.size,
    rarityBreakdown,
    estimatedPortfolioEth: Math.round(portfolioEth * 1e6) / 1e6,
    cards,
  };
}

export function getTopWallets(limit: number): WalletSummary[] {
  const stmts = getStmts();
  const rows = stmts.getTopWallets.all(Math.min(limit, 100)) as Array<{
    wallet_address: string;
    unique_cards: number;
    total_cards: number;
    unique_creators: number;
  }>;

  return rows.map(row => {
    // Quick portfolio estimate: sum floor prices for all their cards
    const deck = getWalletDeck(row.wallet_address);
    return {
      wallet: row.wallet_address,
      uniqueCards: row.unique_cards,
      totalCards: row.total_cards,
      uniqueCreators: row.unique_creators,
      estimatedPortfolioEth: deck?.estimatedPortfolioEth ?? 0,
    };
  });
}

export function getTokenHolderList(tokenId: string): HolderInfo[] {
  const stmts = getStmts();
  const rows = stmts.getHoldersByToken.all(tokenId) as Array<{
    wallet_address: string;
    quantity: number;
  }>;

  return rows.map(r => ({
    wallet: r.wallet_address,
    quantity: r.quantity,
  }));
}
