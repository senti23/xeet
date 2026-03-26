import { config as loadEnv } from 'dotenv';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Walk up from multiple starting points to find .env
function findEnvFile(): string | undefined {
  const starts = [__dirname, process.cwd()];
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 5; i++) {
      const candidate = join(dir, '.env');
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return undefined;
}

const envPath = findEnvFile();
if (envPath) {
  loadEnv({ path: envPath });
}

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  port: parseInt(optional('PORT', '3001'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  isDev: optional('NODE_ENV', 'development') === 'development',

  opensea: {
    apiKey: required('OPENSEA_API_KEY'),
    collectionSlug: 'xeet-creator-cards',
    contract: '0xeC27D2237432D06981e1F18581494661517E1bD3',
    baseUrl: 'https://api.opensea.io',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    inviteCodes: (process.env.TELEGRAM_INVITE_CODES || '').split(',').filter(Boolean),
  },

  xeet: {
    baseUrl: 'https://xeet.ai',
    mvcBaseUrl: 'https://xeet.mvc-web.xyz',
  },

  abscan: {
    apiKey: optional('ABSCAN_API_KEY', ''),
    baseUrl: 'https://api.etherscan.io/v2/api',
    chainId: '2741', // Abstract mainnet
  },

  alchemy: {
    apiKey: optional('ALCHEMY_API_KEY', ''),
  },

  pipeline: {
    intervalMs: 60_000,
    priceRefreshMs: 300_000,
    holderRefreshMs: 600_000,
  },

  // DATA_DIR: where JSON data files live. In dev: repo root. In prod: set via env.
  dataDir: process.env.DATA_DIR
    || (envPath ? dirname(envPath) : resolve(__dirname, '../..')),

  creatorsJsonPath: process.env.DATA_DIR
    ? resolve(process.env.DATA_DIR, 'xeet-creators-full.json')
    : envPath
      ? resolve(dirname(envPath), 'xeet-creators-full.json')
      : resolve(__dirname, '../../xeet-creators-full.json'),
} as const;
