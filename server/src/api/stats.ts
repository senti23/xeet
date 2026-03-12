import type { FastifyInstance } from 'fastify';
import { getCacheArray, getCache } from '../services/data-pipeline.js';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stats', async (_req, reply) => {
    const cache = getCache();
    const data = getCacheArray();

    const totalXeetListings = data.reduce((sum, d) => sum + d.xeetListingCount, 0);
    const totalOsListings = data.reduce((sum, d) => sum + d.osListingCount, 0);

    const xeetFloors = data.filter((d) => d.xeetFloor !== null).map((d) => d.xeetFloor!);
    const osFloors = data.filter((d) => d.osFloor !== null).map((d) => d.osFloor!);

    const creatorsWithListings = new Set(
      data.filter((d) => d.xeetListingCount > 0 || d.osListingCount > 0).map((d) => d.creator),
    ).size;

    return reply.send({
      totalCreators: new Set(data.map((d) => d.creator)).size,
      creatorsWithListings,
      totalXeetListings,
      totalOsListings,
      xeetFloorMin: xeetFloors.length > 0 ? Math.min(...xeetFloors) : null,
      osFloorMin: osFloors.length > 0 ? Math.min(...osFloors) : null,
      ethUsdRate: cache.ethUsdRate,
      lastUpdated: cache.lastUpdated?.toISOString() ?? null,
    });
  });
}
