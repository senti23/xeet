import type { FastifyInstance } from 'fastify';
import {
  getWalletDeck,
  getTopWallets,
  getTokenHolderList,
  getHolderSyncStatus,
} from '../services/holder-service.js';

export async function holdersRoutes(app: FastifyInstance): Promise<void> {

  // Wallet deck — all cards held by a wallet with portfolio estimate
  app.get<{ Params: { wallet: string } }>('/api/deck/:wallet', async (req, reply) => {
    const { wallet } = req.params;
    if (!wallet || !wallet.startsWith('0x') || wallet.length !== 42) {
      return reply.status(400).send({ error: 'Invalid wallet address — must be a 0x address (42 chars)' });
    }

    const deck = getWalletDeck(wallet);
    if (!deck) {
      return reply.status(404).send({ error: 'No cards found for this wallet' });
    }

    const syncStatus = getHolderSyncStatus();
    return {
      data: deck,
      meta: {
        lastSync: syncStatus.lastFullSync,
        holderCount: syncStatus.holderCount,
      },
    };
  });

  // Top wallets (whales) by unique creators and total cards
  app.get<{ Querystring: { limit?: string } }>('/api/whales', async (req) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit ?? '20', 10) || 20));
    const wallets = getTopWallets(limit);
    const syncStatus = getHolderSyncStatus();

    return {
      data: wallets,
      meta: {
        totalHolders: syncStatus.holderCount,
        lastSync: syncStatus.lastFullSync,
      },
    };
  });

  // All holders of a specific token ID
  app.get<{ Params: { tokenId: string } }>('/api/holders/:tokenId', async (req) => {
    const { tokenId } = req.params;
    const holders = getTokenHolderList(tokenId);

    return {
      data: holders,
      meta: {
        tokenId,
        holderCount: holders.length,
        totalSupply: holders.reduce((sum, h) => sum + h.quantity, 0),
      },
    };
  });

  // Holder sync status
  app.get('/api/holders/status', async () => {
    return { data: getHolderSyncStatus() };
  });
}
