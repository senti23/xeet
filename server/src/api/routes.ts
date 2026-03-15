import type { FastifyInstance } from 'fastify';
import { listingsRoutes } from './listings.js';
import { statsRoutes } from './stats.js';
import { salesRoutes } from './sales.js';
import { holdersRoutes } from './holders.js';
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(listingsRoutes);
  await app.register(statsRoutes);
  await app.register(salesRoutes);
  await app.register(holdersRoutes);
}
