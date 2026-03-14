import type { FastifyInstance } from 'fastify';
import { getStmts } from '../db/index.js';
import { isBackfillComplete } from '../services/data-pipeline.js';

interface SalesQuery {
  creator?: string;
  rarity?: string;
  marketplace?: string;
  limit?: string;
  offset?: string;
}

interface TokenSalesParams {
  tokenId: string;
}

export async function salesRoutes(app: FastifyInstance): Promise<void> {
  // Get sales history by creator + rarity
  app.get<{ Querystring: SalesQuery }>('/api/sales', async (req, reply) => {
    const { creator, rarity, marketplace, limit = '100', offset = '0' } = req.query;
    if (!creator) {
      return reply.status(400).send({ error: 'creator query param is required' });
    }

    const stmts = getStmts();
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
    const offsetNum = Math.max(0, parseInt(offset, 10) || 0);

    let sales: any[];
    if (rarity && ['common', 'rare', 'legendary'].includes(rarity.toLowerCase())) {
      sales = stmts.getSalesByCreatorRarity.all(creator.toLowerCase(), rarity.toLowerCase()) as any[];
    } else {
      // All rarities for this creator
      const all: any[] = [];
      for (const r of ['common', 'rare', 'legendary']) {
        const rows = stmts.getSalesByCreatorRarity.all(creator.toLowerCase(), r) as any[];
        all.push(...rows);
      }
      // Sort by date descending
      all.sort((a, b) => (b.sold_at > a.sold_at ? 1 : -1));
      sales = all;
    }

    // Filter by marketplace if specified
    if (marketplace && ['opensea', 'xeet'].includes(marketplace.toLowerCase())) {
      sales = sales.filter((s: any) => s.marketplace === marketplace.toLowerCase());
    }

    const total = sales.length;
    const paged = sales.slice(offsetNum, offsetNum + limitNum);

    return reply.send({
      data: paged,
      meta: {
        total,
        limit: limitNum,
        offset: offsetNum,
        backfillComplete: isBackfillComplete(),
      },
    });
  });

  // Get sales history by tokenId
  app.get<{ Params: TokenSalesParams }>('/api/sales/token/:tokenId', async (req, reply) => {
    const { tokenId } = req.params;
    const stmts = getStmts();
    const sales = stmts.getSalesByToken.all(tokenId) as any[];

    return reply.send({
      data: sales,
      meta: {
        total: sales.length,
        backfillComplete: isBackfillComplete(),
      },
    });
  });
}
