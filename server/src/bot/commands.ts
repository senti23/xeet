import { Context } from 'telegraf';
import { getStmts } from '../db/index.js';
import { isValidCreator, getCreator, type Rarity } from '../services/token-map.js';
import { childLogger } from '../lib/logger.js';

const log = childLogger('bot-commands');

const VALID_RARITIES = ['common', 'rare', 'legendary'];

function isActivated(telegramId: number): boolean {
  const stmts = getStmts();
  const user = stmts.getBotUser.get(telegramId) as { telegram_id: number } | undefined;
  return !!user;
}

export async function handleStart(ctx: Context): Promise<void> {
  const msg = [
    `Welcome to the <b>Xeet Creator Cards Alert Bot</b>! 🎴`,
    ``,
    `To get started, redeem your invite code:`,
    `<code>/redeem YOUR_CODE</code>`,
    ``,
    `Once activated, you can:`,
    `• <code>/subscribe creator rarity eth:0.05 xeets:500</code>`,
    `• <code>/list</code> — view your subscriptions`,
    `• <code>/unsubscribe id</code> — remove a subscription`,
    `• <code>/help</code> — full command guide`,
  ].join('\n');
  await ctx.reply(msg, { parse_mode: 'HTML' });
}

export async function handleRedeem(ctx: Context): Promise<void> {
  const text = (ctx.message as any)?.text || '';
  const parts = text.split(/\s+/);
  const code = parts[1]?.trim();

  if (!code) {
    await ctx.reply('Usage: <code>/redeem YOUR_INVITE_CODE</code>', { parse_mode: 'HTML' });
    return;
  }

  const telegramId = ctx.from!.id;
  const username = ctx.from!.username || ctx.from!.first_name || '';

  // Check if already activated
  if (isActivated(telegramId)) {
    await ctx.reply('You are already activated! Use /help to see commands.');
    return;
  }

  const stmts = getStmts();
  const invite = stmts.getInviteCode.get(code) as { code: string } | undefined;
  if (!invite) {
    await ctx.reply('Invalid or already used invite code.');
    return;
  }

  // Redeem
  stmts.redeemInviteCode.run(telegramId, code);
  stmts.upsertBotUser.run(telegramId, username, code);

  log.info({ telegramId, username, code }, 'User activated');
  await ctx.reply('✅ Activated! You can now create alert subscriptions.\n\nUse /help to see all commands.');
}

export async function handleSubscribe(ctx: Context): Promise<void> {
  const telegramId = ctx.from!.id;
  if (!isActivated(telegramId)) {
    await ctx.reply('Please redeem an invite code first: /redeem YOUR_CODE');
    return;
  }

  const text = (ctx.message as any)?.text || '';
  // Format: /subscribe creator rarity [eth:0.05] [xeets:500]
  const parts = text.split(/\s+/).slice(1); // skip /subscribe

  if (parts.length < 2) {
    await ctx.reply(
      [
        'Usage: <code>/subscribe creator rarity [eth:max] [xeets:max]</code>',
        '',
        'Examples:',
        '<code>/subscribe senti__23 rare eth:0.05</code>',
        '<code>/subscribe senti__23 common xeets:500</code>',
        '<code>/subscribe senti__23 legendary eth:0.1 xeets:1000</code>',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
    return;
  }

  const creatorInput = parts[0].toLowerCase().replace('@', '');
  const rarityInput = parts[1].toLowerCase();

  // Validate creator
  if (!isValidCreator(creatorInput)) {
    await ctx.reply(`Unknown creator: <b>${creatorInput}</b>. Check the handle and try again.`, {
      parse_mode: 'HTML',
    });
    return;
  }

  // Validate rarity
  if (!VALID_RARITIES.includes(rarityInput)) {
    await ctx.reply(`Invalid rarity: <b>${rarityInput}</b>. Use: common, rare, or legendary.`, {
      parse_mode: 'HTML',
    });
    return;
  }

  // Parse thresholds
  let maxEth: number | null = null;
  let maxXeets: number | null = null;

  for (const part of parts.slice(2)) {
    if (part.startsWith('eth:')) {
      const val = parseFloat(part.slice(4));
      if (isNaN(val) || val <= 0) {
        await ctx.reply('Invalid ETH threshold. Use a positive number, e.g. eth:0.05');
        return;
      }
      maxEth = val;
    } else if (part.startsWith('xeets:')) {
      const val = parseFloat(part.slice(6));
      if (isNaN(val) || val <= 0) {
        await ctx.reply('Invalid XEETS threshold. Use a positive number, e.g. xeets:500');
        return;
      }
      maxXeets = val;
    }
  }

  if (maxEth === null && maxXeets === null) {
    await ctx.reply(
      'Please set at least one threshold:\n<code>eth:0.05</code> and/or <code>xeets:500</code>',
      { parse_mode: 'HTML' },
    );
    return;
  }

  const stmts = getStmts();
  const result = stmts.insertSubscription.run(telegramId, creatorInput, rarityInput, maxEth, maxXeets);
  const subId = result.lastInsertRowid;

  const creator = getCreator(creatorInput);
  const displayName = creator?.displayName || creatorInput;

  const thresholds = [];
  if (maxEth !== null) thresholds.push(`≤ ${maxEth} ETH (OpenSea)`);
  if (maxXeets !== null) thresholds.push(`≤ ${maxXeets} XEETS (Xeet)`);

  await ctx.reply(
    [
      `✅ Subscription #${subId} created!`,
      ``,
      `<b>Creator:</b> ${displayName} (@${creatorInput})`,
      `<b>Rarity:</b> ${rarityInput}`,
      `<b>Alerts:</b> ${thresholds.join(' | ')}`,
      ``,
      `You'll be notified when matching listings appear.`,
    ].join('\n'),
    { parse_mode: 'HTML' },
  );

  log.info({ telegramId, creatorInput, rarityInput, maxEth, maxXeets, subId }, 'Subscription created');
}

export async function handleUnsubscribe(ctx: Context): Promise<void> {
  const telegramId = ctx.from!.id;
  if (!isActivated(telegramId)) {
    await ctx.reply('Please redeem an invite code first: /redeem YOUR_CODE');
    return;
  }

  const text = (ctx.message as any)?.text || '';
  const parts = text.split(/\s+/).slice(1);
  const target = parts[0];

  if (!target) {
    await ctx.reply('Usage: <code>/unsubscribe ID</code> or <code>/unsubscribe all</code>', {
      parse_mode: 'HTML',
    });
    return;
  }

  const stmts = getStmts();

  if (target.toLowerCase() === 'all') {
    const result = stmts.deactivateAllSubscriptions.run(telegramId);
    await ctx.reply(`Removed ${result.changes} subscription(s).`);
    log.info({ telegramId, removed: result.changes }, 'All subscriptions removed');
  } else {
    const id = parseInt(target, 10);
    if (isNaN(id)) {
      await ctx.reply('Invalid subscription ID. Use a number or "all".');
      return;
    }
    const result = stmts.deactivateSubscription.run(id, telegramId);
    if (result.changes === 0) {
      await ctx.reply(`Subscription #${id} not found or already removed.`);
    } else {
      await ctx.reply(`Subscription #${id} removed.`);
      log.info({ telegramId, subId: id }, 'Subscription removed');
    }
  }
}

export async function handleList(ctx: Context): Promise<void> {
  const telegramId = ctx.from!.id;
  if (!isActivated(telegramId)) {
    await ctx.reply('Please redeem an invite code first: /redeem YOUR_CODE');
    return;
  }

  const stmts = getStmts();
  const subs = stmts.getUserSubscriptions.all(telegramId) as Array<{
    id: number;
    creator_handle: string;
    rarity: string;
    max_price_eth: number | null;
    max_price_xeets: number | null;
    created_at: string;
  }>;

  if (subs.length === 0) {
    await ctx.reply('No active subscriptions. Use /subscribe to create one.');
    return;
  }

  const lines = ['<b>Your Active Subscriptions:</b>', ''];
  for (const sub of subs) {
    const thresholds = [];
    if (sub.max_price_eth !== null) thresholds.push(`≤ ${sub.max_price_eth} ETH`);
    if (sub.max_price_xeets !== null) thresholds.push(`≤ ${sub.max_price_xeets} XEETS`);
    lines.push(
      `#${sub.id} — @${sub.creator_handle} ${sub.rarity} — ${thresholds.join(' | ')}`,
    );
  }
  lines.push('', 'To remove: <code>/unsubscribe ID</code>');

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
}

export async function handleHelp(ctx: Context): Promise<void> {
  const msg = [
    `<b>Xeet Creator Cards Alert Bot — Commands</b>`,
    ``,
    `<code>/start</code> — Welcome message`,
    `<code>/redeem CODE</code> — Activate with invite code`,
    `<code>/subscribe CREATOR RARITY [eth:MAX] [xeets:MAX]</code>`,
    `  Get alerts when listings appear at or below your thresholds`,
    `  Example: <code>/subscribe senti__23 rare eth:0.05 xeets:500</code>`,
    `<code>/list</code> — View your active subscriptions`,
    `<code>/unsubscribe ID</code> — Remove a subscription`,
    `<code>/unsubscribe all</code> — Remove all subscriptions`,
    `<code>/help</code> — This message`,
    ``,
    `<b>Marketplaces monitored:</b>`,
    `• OpenSea (ETH) — real-time via WebSocket`,
    `• Xeet (XEETS) — checked every 60 seconds`,
    ``,
    `Alerts are deduplicated: same listing at same price won't re-alert.`,
    `A <i>new lower listing</i> on the same card will trigger a new alert.`,
  ].join('\n');
  await ctx.reply(msg, { parse_mode: 'HTML' });
}
