import type { FastifyInstance } from 'fastify';
import { listingsRoutes } from './listings.js';
import { statsRoutes } from './stats.js';
import { getTokenMapStats } from '../services/token-map.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(listingsRoutes);
  await app.register(statsRoutes);

  // Diagnostic endpoint for debugging token map issues
  app.get('/api/debug/token-map', async () => {
    return getTokenMapStats();
  });
}
