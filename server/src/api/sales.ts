import type { FastifyInstance } from 'fastify';
import { getDb, getStmts } from '../db/index.js';
import { isBackfillComplete, isOsBackfillComplete } from '../services/data-pipeline.js';
import { getAllCreators } from '../services/token-map.js';

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

  // Top cards by Xeet volume (leaderboard)
  app.get<{ Querystring: { limit?: string; sort?: string } }>('/api/sales/top', async (req, reply) => {
    const { limit = '20', sort = 'xeet_volume' } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const validSorts = ['xeet_volume', 'os_volume', 'total_sales', 'xeet_sales', 'os_sales'];
    const sortCol = validSorts.includes(sort) ? sort : 'xeet_volume';

    const db = getDb();
    const rows = db.prepare(`
      SELECT
        creator_handle,
        rarity,
        COUNT(*) as total_sales,
        COUNT(CASE WHEN marketplace = 'xeet' THEN 1 END) as xeet_sales,
        COUNT(CASE WHEN marketplace = 'opensea' THEN 1 END) as os_sales,
        ROUND(SUM(CASE WHEN marketplace = 'xeet' THEN price ELSE 0 END), 1) as xeet_volume,
        ROUND(SUM(CASE WHEN marketplace = 'opensea' THEN price ELSE 0 END), 6) as os_volume,
        ROUND(AVG(CASE WHEN marketplace = 'xeet' THEN price END), 1) as avg_xeet_price,
        ROUND(AVG(CASE WHEN marketplace = 'opensea' THEN price END), 6) as avg_os_price,
        MIN(sold_at) as first_sale,
        MAX(sold_at) as last_sale
      FROM sale_history
      GROUP BY creator_handle, rarity
      ORDER BY ${sortCol} DESC
      LIMIT ?
    `).all(limitNum) as any[];

    // Enrich with display names from creator seed
    const allCreators = getAllCreators();
    const enriched = rows.map((r: any) => ({
      ...r,
      displayName: allCreators.get(r.creator_handle.toLowerCase())?.displayName ?? r.creator_handle,
    }));

    return reply.send({
      data: enriched,
      meta: { sort: sortCol, limit: limitNum },
    });
  });

  // Top creators by combined Xeet volume (all rarities merged)
  app.get<{ Querystring: { limit?: string } }>('/api/sales/top-creators', async (req, reply) => {
    const { limit = '20' } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const db = getDb();
    const rows = db.prepare(`
      SELECT
        creator_handle,
        COUNT(CASE WHEN marketplace = 'xeet' THEN 1 END) as xeet_sales,
        ROUND(SUM(CASE WHEN marketplace = 'xeet' THEN price ELSE 0 END), 1) as xeet_volume,
        COUNT(CASE WHEN marketplace = 'opensea' THEN 1 END) as os_sales,
        ROUND(SUM(CASE WHEN marketplace = 'opensea' THEN price ELSE 0 END), 6) as os_volume,
        COUNT(*) as total_sales,
        GROUP_CONCAT(DISTINCT rarity) as rarities,
        MIN(sold_at) as first_sale,
        MAX(sold_at) as last_sale
      FROM sale_history
      GROUP BY creator_handle
      ORDER BY xeet_volume DESC
      LIMIT ?
    `).all(limitNum) as any[];

    const allCreators = getAllCreators();
    const enriched = rows.map((r: any) => ({
      ...r,
      displayName: allCreators.get(r.creator_handle.toLowerCase())?.displayName ?? r.creator_handle,
    }));

    return reply.send({
      data: enriched,
      meta: { limit: limitNum },
    });
  });

  // Comprehensive sales summary — ALL creators × rarities (including zero-sale)
  app.get<{ Querystring: { marketplace?: string } }>('/api/sales/summary', async (req, reply) => {
    const { marketplace } = req.query;
    const db = getDb();
    const allCreators = getAllCreators();

    // Build aggregate stats per creator × rarity from sale_history
    let query = `
      SELECT creator_handle, rarity, marketplace,
        COUNT(*) as sale_count,
        SUM(price) as total_volume,
        AVG(price) as avg_price,
        MIN(price) as min_price,
        MAX(price) as max_price,
        MIN(sold_at) as first_sale,
        MAX(sold_at) as last_sale
      FROM sale_history
    `;
    const params: string[] = [];
    if (marketplace && ['opensea', 'xeet'].includes(marketplace.toLowerCase())) {
      query += ' WHERE marketplace = ?';
      params.push(marketplace.toLowerCase());
    }
    query += ' GROUP BY creator_handle, rarity, marketplace ORDER BY creator_handle, rarity';

    const rows = db.prepare(query).all(...params) as Array<{
      creator_handle: string; rarity: string; marketplace: string;
      sale_count: number; total_volume: number; avg_price: number;
      min_price: number; max_price: number; first_sale: string; last_sale: string;
    }>;

    // Index by creator:rarity:marketplace
    const statsMap = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      statsMap.set(`${row.creator_handle}:${row.rarity}:${row.marketplace}`, row);
    }

    // Build full grid: every creator × rarity
    const rarities = ['common', 'rare', 'legendary'] as const;
    const summary: Array<{
      creator: string;
      displayName: string;
      rarity: string;
      xeet: { sales: number; volume: number; avgPrice: number; minPrice: number; maxPrice: number; firstSale: string | null; lastSale: string | null } | null;
      opensea: { sales: number; volume: number; avgPrice: number; minPrice: number; maxPrice: number; currency: string; firstSale: string | null; lastSale: string | null } | null;
      totalSales: number;
    }> = [];

    for (const [, creator] of allCreators) {
      for (const rarity of rarities) {
        const handle = creator.handle.toLowerCase();
        const xeetStats = statsMap.get(`${handle}:${rarity}:xeet`);
        const osStats = statsMap.get(`${handle}:${rarity}:opensea`);

        summary.push({
          creator: creator.handle,
          displayName: creator.displayName,
          rarity,
          xeet: xeetStats ? {
            sales: xeetStats.sale_count,
            volume: xeetStats.total_volume,
            avgPrice: Math.round(xeetStats.avg_price * 10) / 10,
            minPrice: xeetStats.min_price,
            maxPrice: xeetStats.max_price,
            firstSale: xeetStats.first_sale,
            lastSale: xeetStats.last_sale,
          } : null,
          opensea: osStats ? {
            sales: osStats.sale_count,
            volume: Math.round(osStats.total_volume * 1e6) / 1e6,
            avgPrice: Math.round(osStats.avg_price * 1e6) / 1e6,
            minPrice: Math.round(osStats.min_price * 1e6) / 1e6,
            maxPrice: Math.round(osStats.max_price * 1e6) / 1e6,
            currency: 'ETH',
            firstSale: osStats.first_sale,
            lastSale: osStats.last_sale,
          } : null,
          totalSales: (xeetStats?.sale_count ?? 0) + (osStats?.sale_count ?? 0),
        });
      }
    }

    // Global stats
    const totalSalesAll = (db.prepare('SELECT COUNT(*) as c FROM sale_history').get() as any).c;
    const totalXeet = (db.prepare("SELECT COUNT(*) as c FROM sale_history WHERE marketplace = 'xeet'").get() as any).c;
    const totalOs = (db.prepare("SELECT COUNT(*) as c FROM sale_history WHERE marketplace = 'opensea'").get() as any).c;
    const creatorsWithSales = (db.prepare('SELECT COUNT(DISTINCT creator_handle) as c FROM sale_history').get() as any).c;
    const earliest = (db.prepare('SELECT MIN(sold_at) as d FROM sale_history').get() as any).d;
    const latest = (db.prepare('SELECT MAX(sold_at) as d FROM sale_history').get() as any).d;

    return reply.send({
      data: summary,
      meta: {
        totalCreators: allCreators.size,
        totalCreatorRarities: summary.length,
        creatorsWithSales,
        creatorsWithNoSales: allCreators.size - creatorsWithSales,
        totalSales: totalSalesAll,
        xeetSales: totalXeet,
        openseaSales: totalOs,
        dateRange: { earliest, latest },
        backfillComplete: isBackfillComplete(),
        osBackfillComplete: isOsBackfillComplete(),
      },
    });
  });
}
