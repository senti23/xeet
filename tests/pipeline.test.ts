/**
 * Data Pipeline Integration Test
 * Tests the pipeline's ability to aggregate data from multiple sources.
 * Run: npx tsx tests/pipeline.test.ts
 */

import { getDb, getStmts } from '../server/src/db/index.js';
import { initTokenMap, getAllCreators, isValidCreator, getCreatorRarity } from '../server/src/services/token-map.js';

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}: ${(err as Error).message}`);
  }
}

async function main() {
  console.log('=== Pipeline Integration Tests ===\n');

  // Test DB initialization
  console.log('--- Database ---');
  await test('DB initializes without error', () => {
    const db = getDb();
    if (!db) throw new Error('DB is null');
  });

  await test('Tables created', () => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    const required = ['token_map', 'bot_users', 'invite_codes', 'subscriptions', 'alert_history'];
    for (const name of required) {
      if (!names.includes(name)) throw new Error(`Missing table: ${name}`);
    }
  });

  await test('Invite codes seeded', () => {
    const stmts = getStmts();
    const code = stmts.getInviteCode.get('XEET2024') as { code: string } | undefined;
    if (!code) throw new Error('XEET2024 invite code not found');
  });

  // Test token map
  console.log('\n--- Token Map ---');
  await test('Token map initializes from JSON seed', async () => {
    await initTokenMap();
    const creators = getAllCreators();
    if (creators.size < 300) throw new Error(`Only ${creators.size} creators loaded, expected 391`);
  });

  await test('Known creator exists (bearish_af)', () => {
    if (!isValidCreator('bearish_af')) throw new Error('bearish_af not found');
  });

  await test('Unknown creator returns false', () => {
    if (isValidCreator('nonexistent_creator_xyz')) throw new Error('Should return false');
  });

  // Test subscription CRUD
  console.log('\n--- Subscriptions ---');
  await test('Can create subscription', () => {
    const stmts = getStmts();
    // First create a bot user
    stmts.upsertBotUser.run(12345, 'testuser', 'XEET2024');
    const result = stmts.insertSubscription.run(12345, 'bearish_af', 'common', 0.05, 500);
    if (!result.lastInsertRowid) throw new Error('Insert failed');
  });

  await test('Can list user subscriptions', () => {
    const stmts = getStmts();
    const subs = stmts.getUserSubscriptions.all(12345) as Array<{ id: number }>;
    if (subs.length === 0) throw new Error('No subscriptions found');
  });

  await test('Can match subscriptions by creator+rarity', () => {
    const stmts = getStmts();
    const matches = stmts.getMatchingSubscriptions.all('bearish_af', 'common') as Array<{ id: number }>;
    if (matches.length === 0) throw new Error('No matching subscriptions');
  });

  // Test alert dedup
  console.log('\n--- Alert Dedup ---');
  await test('Alert insert works', () => {
    const stmts = getStmts();
    stmts.insertAlertHistory.run(1, 'order-hash-1', '0.05', 'opensea');
  });

  await test('Duplicate alert is ignored (INSERT OR IGNORE)', () => {
    const stmts = getStmts();
    // Should not throw
    stmts.insertAlertHistory.run(1, 'order-hash-1', '0.05', 'opensea');
  });

  await test('Same order with different price is NOT a duplicate', () => {
    const stmts = getStmts();
    stmts.insertAlertHistory.run(1, 'order-hash-1', '0.04', 'opensea');
    const exists = stmts.checkAlertExists.get(1, 'order-hash-1', '0.04');
    if (!exists) throw new Error('Should exist as a separate entry');
  });

  await test('checkAlertExists returns truthy for existing alert', () => {
    const stmts = getStmts();
    const exists = stmts.checkAlertExists.get(1, 'order-hash-1', '0.05');
    if (!exists) throw new Error('Should exist');
  });

  await test('checkAlertExists returns undefined for non-existing alert', () => {
    const stmts = getStmts();
    const exists = stmts.checkAlertExists.get(1, 'order-hash-999', '0.05');
    if (exists) throw new Error('Should not exist');
  });

  // Cleanup
  const db = getDb();
  db.exec('DELETE FROM alert_history');
  db.exec('DELETE FROM subscriptions');
  db.exec('DELETE FROM bot_users');

  console.log('\n=== All tests complete ===');
}

main().catch(console.error);
