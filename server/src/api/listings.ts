import type { FastifyInstance } from 'fastify';
import { getCacheArray, getCache } from '../services/data-pipeline.js';

interface ListingsQuery {
  search?: string;
  rarity?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: string;
  limit?: string;
}

export async function listingsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: ListingsQuery }>('/api/listings', async (req, reply) => {
    const { search, rarity, sort, order = 'asc', page = '1', limit = '100' } = req.query;
    const cache = getCache();

    let data = getCacheArray();

    // Filter by search
    if (search) {
      const term = search.toLowerCase();
      data = data.filter(
        (d) =>
          d.creator.toLowerCase().includes(term) ||
          d.displayName.toLowerCase().includes(term),
      );
    }

    // Filter by rarity
    if (rarity && ['common', 'rare', 'legendary'].includes(rarity.toLowerCase())) {
      data = data.filter((d) => d.rarity === rarity.toLowerCase());
    }

    // Sort
    if (sort) {
      data = [...data].sort((a, b) => {
        let aVal: number | null;
        let bVal: number | null;
        switch (sort) {
          case 'xeet_floor':
            aVal = a.xeetFloor;
            bVal = b.xeetFloor;
            break;
          case 'os_floor':
            aVal = a.osFloor;
            bVal = b.osFloor;
            break;
          case 'usd':
            aVal = a.usdEstimate;
            bVal = b.usdEstimate;
            break;
          case 'best_offer':
            aVal = a.bestOffer;
            bVal = b.bestOffer;
            break;
          case 'creator':
            return order === 'asc'
              ? a.creator.localeCompare(b.creator)
              : b.creator.localeCompare(a.creator);
          default:
            return 0;
        }
        // Nulls go to the end
        if (aVal === null && bVal === null) return 0;
        if (aVal === null) return 1;
        if (bVal === null) return -1;
        return order === 'asc' ? aVal - bVal : bVal - aVal;
      });
    }

    const total = data.length;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
    const offset = (pageNum - 1) * limitNum;
    const paged = data.slice(offset, offset + limitNum);

    return reply.send({
      data: paged,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        lastUpdated: cache.lastUpdated?.toISOString() ?? null,
        ethUsdRate: cache.ethUsdRate,
      },
    });
  });
}
