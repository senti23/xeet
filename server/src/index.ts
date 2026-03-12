import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { childLogger } from './lib/logger.js';
import { getDb } from './db/index.js';
import { initTokenMap } from './services/token-map.js';
import { startPipeline, stopPipeline } from './services/data-pipeline.js';
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
  await app.register(cors, {
    origin: config.isDev ? true : ['http://localhost:3000'],
    methods: ['GET'],
  });

  // Register API routes
  await registerRoutes(app);

  // Health check
  app.get('/api/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // Start Fastify server
  await app.listen({ port: config.port, host: '0.0.0.0' });
  log.info({ port: config.port }, 'API server listening');

  // Start data pipeline (first cycle runs immediately)
  await startPipeline();

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
