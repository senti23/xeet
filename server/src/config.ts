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
    collectionSlug: optional('XCC_OS_SLUG', 'xeet-creator-cards-mega'),
    contract: optional('XCC_CONTRACT', '0xce8cb6676f6cfb3161a72a723b436987c6cf4e68'),
    chain: optional('XCC_OS_CHAIN', 'megaeth'),
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
    // Etherscan v2 unified API — one key works across chains via the chainid param.
    apiKey: optional('ABSCAN_API_KEY', '') || optional('ETHERSCAN_API_KEY', ''),
    baseUrl: 'https://api.etherscan.io/v2/api',
    chainId: optional('XCC_CHAIN_ID', '4326'), // MegaETH mainnet
  },

  // Xeet on-chain marketplace (OrderExecuted logs). Contract has no code on MegaETH and
  // went silent on Abstract ~2026-04; trades now flow through the Xeet API only.
  // Disabled by default — flip XEET_MP_ONCHAIN=true if an on-chain marketplace returns.
  xeetMarketplace: {
    enabled: optional('XEET_MP_ONCHAIN', 'false') === 'true',
    chainId: '2741', // Abstract — where the historical OrderExecuted logs live
    address: '0x4424844a9A96C143345C2470905403a4009AF237',
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
