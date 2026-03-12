import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

loadEnv({ path: resolve(__dirname, '../../.env') });

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

  pipeline: {
    intervalMs: 60_000,
    priceRefreshMs: 300_000,
  },

  creatorsJsonPath: resolve(__dirname, '../../xeet-creators-full.json'),
} as const;
