import { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { childLogger } from '../lib/logger.js';
import { setBot, checkOpenSeaListing, checkXeetListing } from './alerts.js';
import { handleStart, handleRedeem, handleSubscribe, handleUnsubscribe, handleList, handleHelp } from './commands.js';
import { onNewListing } from '../services/opensea-stream.js';
import { onXeetListingChange } from '../services/data-pipeline.js';

const log = childLogger('telegram-bot');

let bot: Telegraf | null = null;

export async function startBot(): Promise<void> {
  if (!config.telegram.botToken) {
    log.warn('No TELEGRAM_BOT_TOKEN set — bot disabled. Set it in .env to enable.');
    return;
  }

  bot = new Telegraf(config.telegram.botToken);

  // Register commands
  bot.start(handleStart);
  bot.command('redeem', handleRedeem);
  bot.command('subscribe', handleSubscribe);
  bot.command('unsubscribe', handleUnsubscribe);
  bot.command('list', handleList);
  bot.command('help', handleHelp);

  // Pass bot to alert engine
  setBot(bot);

  // Wire up OpenSea stream events → alert checker
  onNewListing(async (listing) => {
    await checkOpenSeaListing(listing);
  });

  // Wire up Xeet listing changes → alert checker
  onXeetListingChange(async (listing, isNew, isPriceDrop) => {
    await checkXeetListing(listing, isNew, isPriceDrop);
  });

  // Error handler
  bot.catch((err) => {
    log.error({ err }, 'Telegraf error');
  });

  // Launch in polling mode
  await bot.launch();
  log.info('Telegram bot started');

  // Graceful shutdown
  const shutdown = () => {
    bot?.stop('SIGTERM');
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

export function stopBot(): void {
  if (bot) {
    bot.stop();
    log.info('Telegram bot stopped');
  }
}
