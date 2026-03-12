/**
 * Alert Engine Integration Test
 * Tests subscription matching, dedup logic, and both marketplace alert paths.
 * Run: npx tsx tests/alerts.test.ts
 */

import { getDb, getStmts } from '../server/src/db/index.js';
import { initTokenMap } from '../server/src/services/token-map.js';

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}: ${(err as Error).message}`);
  }
}

async function main() {
  console.log('=== Alert Engine Tests ===\n');

  // Init
  await initTokenMap();
  const stmts = getStmts();

  // Setup test user and subscriptions
  stmts.upsertBotUser.run(99999, 'alerttester', 'ALPHA');

  // Subscription 1: OpenSea ETH threshold
  stmts.insertSubscription.run(99999, 'bearish_af', 'common', 0.05, null);
  // Subscription 2: Xeet XEETS threshold
  stmts.insertSubscription.run(99999, 'bearish_af', 'common', null, 500);
  // Subscription 3: Both thresholds
  stmts.insertSubscription.run(99999, 'bearish_af', 'rare', 0.1, 1000);
  // Subscription 4: Different creator
  stmts.insertSubscription.run(99999, 'tolibear_', 'common', 0.03, null);

  console.log('--- Subscription Matching ---');

  await test('Matches OpenSea sub for bearish_af common', () => {
    const matches = stmts.getMatchingSubscriptions.all('bearish_af', 'common') as Array<{
      id: number; max_price_eth: number | null; max_price_xeets: number | null
    }>;
    if (matches.length < 2) throw new Error(`Expected 2 matches, got ${matches.length}`);
  });

  await test('Does not match wrong rarity', () => {
    const matches = stmts.getMatchingSubscriptions.all('bearish_af', 'legendary') as Array<{ id: number }>;
    if (matches.length !== 0) throw new Error(`Expected 0 matches, got ${matches.length}`);
  });

  await test('Does not match wrong creator', () => {
    const matches = stmts.getMatchingSubscriptions.all('nonexistent', 'common') as Array<{ id: number }>;
    if (matches.length !== 0) throw new Error(`Expected 0 matches, got ${matches.length}`);
  });

  console.log('\n--- Dedup Logic ---');

  // Get a subscription ID
  const subs = stmts.getUserSubscriptions.all(99999) as Array<{ id: number }>;
  const subId = subs[0].id;

  await test('First alert on orderHash passes dedup', () => {
    const exists = stmts.checkAlertExists.get(subId, 'os-order-123', '0.04');
    if (exists) throw new Error('Should not exist yet');
  });

  await test('Recording alert works', () => {
    stmts.insertAlertHistory.run(subId, 'os-order-123', '0.04', 'opensea');
    const exists = stmts.checkAlertExists.get(subId, 'os-order-123', '0.04');
    if (!exists) throw new Error('Should exist after recording');
  });

  await test('Same orderHash+price is deduped', () => {
    const exists = stmts.checkAlertExists.get(subId, 'os-order-123', '0.04');
    if (!exists) throw new Error('Should be deduped');
  });

  await test('Same card, new lower price (different orderHash) is NOT deduped', () => {
    const exists = stmts.checkAlertExists.get(subId, 'os-order-456', '0.03');
    if (exists) throw new Error('New order hash should not be deduped');
  });

  await test('Same orderHash but different price is NOT deduped', () => {
    const exists = stmts.checkAlertExists.get(subId, 'os-order-123', '0.03');
    if (exists) throw new Error('Different price should not be deduped');
  });

  console.log('\n--- Xeet Dedup ---');

  await test('Xeet alert recording works', () => {
    stmts.insertAlertHistory.run(subId, 'xeet-order-001', '400', 'xeet');
    const exists = stmts.checkAlertExists.get(subId, 'xeet-order-001', '400');
    if (!exists) throw new Error('Should exist');
  });

  await test('Xeet same listing+price deduped', () => {
    const exists = stmts.checkAlertExists.get(subId, 'xeet-order-001', '400');
    if (!exists) throw new Error('Should be deduped');
  });

  await test('Xeet new listing (different hash) not deduped', () => {
    const exists = stmts.checkAlertExists.get(subId, 'xeet-order-002', '350');
    if (exists) throw new Error('Should not be deduped');
  });

  // Cleanup
  const db = getDb();
  db.exec('DELETE FROM alert_history');
  db.exec('DELETE FROM subscriptions WHERE telegram_id = 99999');
  db.exec('DELETE FROM bot_users WHERE telegram_id = 99999');

  console.log('\n=== All alert tests complete ===');
}

main().catch(console.error);
