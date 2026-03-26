import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { childLogger } from './lib/logger.js';
import { getDb } from './db/index.js';
import { initTokenMap, getTokenMapStats } from './services/token-map.js';
import { startPipeline, stopPipeline, getBackfillStatus } from './services/data-pipeline.js';
import { refreshDeckData } from './services/deck-refresh.js';
import { startStream, stopStream } from './services/opensea-stream.js';
import { startBot, stopBot } from './bot/index.js';
import { registerRoutes } from './api/routes.js';

const log = childLogger('server');

async function main(): Promise<void> {
  // Initialize database (creates tables, seeds invite codes)
  getDb();
  log.info('Database ready');

  // Initialize token map (loads creator seed + SQLite cache, kicks off background OpenSea sync)
  await initTokenMap();

  // Create Fastify instance
  const app = Fastify({ logger: false });

  // CORS for Next.js frontend
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:6900',
    process.env.FRONTEND_URL,
  ].filter(Boolean) as string[];

  await app.register(cors, {
    origin: config.isDev ? true : allowedOrigins,
    methods: ['GET', 'POST'],
  });

  // Register API routes
  await registerRoutes(app);

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // Debug: token map status — use ?handle=senti to search
  app.get<{ Querystring: { handle?: string } }>('/api/debug/token-map', async (req) => ({
    ...getTokenMapStats(req.query.handle),
    backfill: getBackfillStatus(),
  }));

  // Start Fastify server
  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info({ port: config.port }, 'API server listening');

  // Start data pipeline (first cycle runs immediately)
  await startPipeline();

  // Unified deck refresh: holders → scores → floor prices
  // First run 10s after startup, then every 10 minutes
  const DECK_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
  setTimeout(() => {
    refreshDeckData()
      .then((r) => log.info({ duration: r.duration, scores: r.scoresComputed, holderRows: r.holderRows }, 'Initial deck refresh complete'))
      .catch((err) => log.error({ err }, 'Initial deck refresh failed'));
  }, 10_000);
  setInterval(() => {
    refreshDeckData()
      .then((r) => log.info({ duration: r.duration, scores: r.scoresComputed }, 'Scheduled deck refresh complete'))
      .catch((err) => log.error({ err }, 'Scheduled deck refresh failed'));
  }, DECK_REFRESH_INTERVAL_MS);

  // Start OpenSea WebSocket stream
  await startStream();

  // Start Telegram bot
  await startBot();

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    stopPipeline();
    stopStream();
    stopBot();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error({ err }, 'Fatal startup error');
  process.exit(1);
});
