import { getStmts } from '../db/index.js';
import { config } from '../config.js';
import { childLogger } from '../lib/logger.js';
import type { StreamListing } from '../services/opensea-stream.js';
import type { XeetListing } from '../services/xeet-client.js';
import type { Telegraf } from 'telegraf';

const log = childLogger('alerts');

let bot: Telegraf | null = null;

export function setBot(telegrafBot: Telegraf): void {
  bot = telegrafBot;
}

interface Subscription {
  id: number;
  telegram_id: number;
  creator_handle: string;
  rarity: string;
  max_price_eth: number | null;
  max_price_xeets: number | null;
  active: number;
}

function checkDedup(subscriptionId: number, orderHash: string, price: string): boolean {
  const stmts = getStmts();
  const existing = stmts.checkAlertExists.get(subscriptionId, orderHash, price);
  return !!existing;
}

function recordAlert(subscriptionId: number, orderHash: string, price: string, marketplace: 'opensea' | 'xeet'): void {
  const stmts = getStmts();
  stmts.insertAlertHistory.run(subscriptionId, orderHash, price, marketplace);
}

async function sendAlert(
  telegramId: number,
  message: string,
): Promise<void> {
  if (!bot) {
    log.warn('Bot not initialized, cannot send alert');
    return;
  }

  try {
    await bot.telegram.sendMessage(telegramId, message, { parse_mode: 'HTML' });
    log.info({ telegramId }, 'Alert sent');
  } catch (err) {
    log.error({ err, telegramId }, 'Failed to send alert');
  }
}

function formatOpenSeaAlert(listing: StreamListing, sub: Subscription): string {
  const lines = [
    `🔔 <b>OpenSea Listing Alert</b>`,
    ``,
    `<b>Creator:</b> @${listing.creatorHandle}`,
    `<b>Rarity:</b> ${listing.rarity.charAt(0).toUpperCase() + listing.rarity.slice(1)}`,
    `<b>Price:</b> ${listing.ethPrice.toFixed(6)} ETH`,
    `<b>Your Threshold:</b> ${sub.max_price_eth} ETH`,
    `<b>Token ID:</b> ${listing.tokenId}`,
  ];
  if (listing.expirationDate) {
    lines.push(`<b>Expires:</b> ${new Date(listing.expirationDate).toUTCString()}`);
  }
  lines.push(
    ``,
    `<a href="https://opensea.io/assets/${config.opensea.chain}/${config.opensea.contract}/${listing.tokenId}">View on OpenSea</a>`,
  );
  return lines.join('\n');
}

function formatXeetAlert(
  listing: XeetListing,
  sub: Subscription,
  isNew: boolean,
  isPriceDrop: boolean,
): string {
  const tag = isPriceDrop ? '📉 Price Drop' : '🆕 New Listing';
  const lines = [
    `🔔 <b>Xeet Marketplace Alert — ${tag}</b>`,
    ``,
    `<b>Creator:</b> @${listing.creatorHandle || listing.creatorId}`,
    `<b>Rarity:</b> ${listing.rarity}`,
    `<b>Price:</b> ${listing.xeetPrice} XEETS`,
    `<b>Your Threshold:</b> ${sub.max_price_xeets} XEETS`,
    `<b>Seller:</b> ${listing.sellerHandle || listing.sellerWalletAddress?.slice(0, 10) + '...'}`,
  ];
  if (listing.deadline) {
    lines.push(`<b>Deadline:</b> ${new Date(listing.deadline).toUTCString()}`);
  }
  lines.push(``, `<a href="https://xeet.ai/marketplace">View on Xeet</a>`);
  return lines.join('\n');
}

/** Check OpenSea listing against all matching subscriptions */
export async function checkOpenSeaListing(listing: StreamListing): Promise<void> {
  const stmts = getStmts();
  const subs = stmts.getMatchingSubscriptions.all(
    listing.creatorHandle.toLowerCase(),
    listing.rarity,
  ) as Subscription[];

  for (const sub of subs) {
    if (sub.max_price_eth === null) continue;
    if (listing.ethPrice > sub.max_price_eth) continue;

    const priceStr = listing.ethPrice.toFixed(8);
    if (checkDedup(sub.id, listing.orderHash, priceStr)) {
      log.debug({ subId: sub.id, orderHash: listing.orderHash }, 'Alert deduplicated (OpenSea)');
      continue;
    }

    recordAlert(sub.id, listing.orderHash, priceStr, 'opensea');
    const msg = formatOpenSeaAlert(listing, sub);
    await sendAlert(sub.telegram_id, msg);
  }
}

/** Check Xeet listing against all matching subscriptions */
export async function checkXeetListing(
  listing: XeetListing,
  isNew: boolean,
  isPriceDrop: boolean,
): Promise<void> {
  const cr = (listing.creatorHandle || listing.creatorId || '').toLowerCase();
  const rarity = (listing.rarity || '').toLowerCase();
  if (!cr || !rarity) return;

  const stmts = getStmts();
  const subs = stmts.getMatchingSubscriptions.all(cr, rarity) as Subscription[];

  for (const sub of subs) {
    if (sub.max_price_xeets === null) continue;
    if (listing.xeetPrice > sub.max_price_xeets) continue;

    const orderHash = listing.orderHash || listing.id;
    const priceStr = String(listing.xeetPrice);
    if (checkDedup(sub.id, orderHash, priceStr)) {
      log.debug({ subId: sub.id, orderHash }, 'Alert deduplicated (Xeet)');
      continue;
    }

    recordAlert(sub.id, orderHash, priceStr, 'xeet');
    const msg = formatXeetAlert(listing, sub, isNew, isPriceDrop);
    await sendAlert(sub.telegram_id, msg);
  }
}
