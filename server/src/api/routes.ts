import type { FastifyInstance } from 'fastify';
import { listingsRoutes } from './listings.js';
import { statsRoutes } from './stats.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(listingsRoutes);
  await app.register(statsRoutes);
}
