import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { createTables, prepareStatements, type PreparedStatements } from './schema.js';
import { childLogger } from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = childLogger('db');

const DB_PATH = process.env.DB_PATH || resolve(__dirname, '../../../xeet.db');

let db: Database.Database;
let stmts: PreparedStatements;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    createTables(db);
    stmts = prepareStatements(db);

    // Seed invite codes from env
    if (config.telegram.inviteCodes.length > 0) {
      const insert = stmts.insertInviteCode;
      const tx = db.transaction((codes: string[]) => {
        for (const code of codes) {
          insert.run(code.trim());
        }
      });
      tx(config.telegram.inviteCodes);
      log.info({ count: config.telegram.inviteCodes.length }, 'Invite codes seeded');
    }

    // One-time cleanup: remove duplicate OpenSea sales caused by
    // Unix vs ISO timestamp mismatch (e.g. "1772471387.0" vs "2026-03-01T...")
    const dupeCleanup = db.prepare(`
      DELETE FROM sale_history WHERE id IN (
        SELECT id FROM sale_history
        WHERE marketplace = 'opensea' AND sold_at GLOB '[0-9]*'
      )
    `);
    const dupeResult = dupeCleanup.run();
    if (dupeResult.changes > 0) {
      log.info({ removed: dupeResult.changes }, 'Cleaned up OpenSea sales with raw Unix timestamps (duplicates)');
      // Reset OS backfill so it re-fetches the cleaned rows with correct timestamps
      db.prepare("DELETE FROM pipeline_meta WHERE key = 'os_backfill_complete'").run();
    }

    // One-time fix v2: reset Xeet backfill to re-run with LISTING_FILLED filter
    // (previous backfill may have double-counted sales from LISTING_FILLED events)
    const xeetFixApplied = db.prepare("SELECT value FROM pipeline_meta WHERE key = 'xeet_listing_filled_fix_v3'").get() as { value: string } | undefined;
    if (!xeetFixApplied) {
      // Clear all Xeet sales and backfill flag so it re-runs with strict SALE-only filter
      const cleared = db.prepare("DELETE FROM sale_history WHERE marketplace = 'xeet'").run();
      db.prepare("DELETE FROM pipeline_meta WHERE key = 'xeet_backfill_complete'").run();
      db.prepare("INSERT OR REPLACE INTO pipeline_meta (key, value, updated_at) VALUES ('xeet_listing_filled_fix_v3', 'true', datetime('now'))").run();
      log.info({ cleared: cleared.changes }, 'Cleared Xeet sales for clean re-backfill (strict SALE filter v3)');
    }

    // One-time migration: clear sale_history for on-chain pipeline rebuild
    const onchainMigrationApplied = db.prepare(
      "SELECT value FROM pipeline_meta WHERE key = 'onchain_pipeline_v1'",
    ).get() as { value: string } | undefined;
    if (!onchainMigrationApplied) {
      const cleared = db.prepare('DELETE FROM sale_history').run();
      db.prepare("DELETE FROM pipeline_meta WHERE key IN ('xeet_backfill_complete', 'os_backfill_complete', 'onchain_backfill_complete', 'last_synced_block')").run();
      db.prepare(
        "INSERT OR REPLACE INTO pipeline_meta (key, value, updated_at) VALUES ('onchain_pipeline_v1', 'true', datetime('now'))",
      ).run();
      log.info({ cleared: cleared.changes }, 'Cleared sale_history for on-chain pipeline migration v1');
    }

    // One-time migration v2: rebuild sale_history from on-chain event logs (OrderExecuted + OpenSea API)
    const v2MigrationApplied = db.prepare(
      "SELECT value FROM pipeline_meta WHERE key = 'onchain_v2_event_logs'",
    ).get() as { value: string } | undefined;
    if (!v2MigrationApplied) {
      const cleared = db.prepare('DELETE FROM sale_history').run();
      db.prepare("DELETE FROM pipeline_meta WHERE key IN ('xeet_backfill_complete', 'os_backfill_complete', 'onchain_backfill_complete', 'last_synced_block', 'last_xeet_synced_block')").run();
      db.prepare(
        "INSERT OR REPLACE INTO pipeline_meta (key, value, updated_at) VALUES ('onchain_v2_event_logs', 'true', datetime('now'))",
      ).run();
      log.info({ cleared: cleared.changes }, 'Cleared sale_history for on-chain pipeline v2 (event logs)');
    }

    // One-time migration v3: remove API-sourced Xeet duplicates + switch dedup index to tx_hash
    const v3DedupApplied = db.prepare(
      "SELECT value FROM pipeline_meta WHERE key = 'onchain_v3_txhash_dedup'",
    ).get() as { value: string } | undefined;
    if (!v3DedupApplied) {
      // Delete API-sourced Xeet records (no tx_hash) — on-chain versions already exist
      const deleted = db.prepare("DELETE FROM sale_history WHERE marketplace = 'xeet' AND tx_hash IS NULL").run();
      // Replace the dedup index with tx_hash-based one
      db.exec('DROP INDEX IF EXISTS idx_sale_dedup');
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_dedup ON sale_history(marketplace, token_id, tx_hash, price)');
      db.prepare(
        "INSERT OR REPLACE INTO pipeline_meta (key, value, updated_at) VALUES ('onchain_v3_txhash_dedup', 'true', datetime('now'))",
      ).run();
      log.info({ deleted: deleted.changes }, 'Removed API-sourced Xeet duplicates + switched dedup index to tx_hash');
    }

    // One-time migration v4: re-run OS backfill uncapped (previous run hit MAX_PAGES=50 → 10k cap)
    const v4OsRecapApplied = db.prepare(
      "SELECT value FROM pipeline_meta WHERE key = 'os_backfill_uncapped_v4'",
    ).get() as { value: string } | undefined;
    if (!v4OsRecapApplied) {
      const cleared = db.prepare("DELETE FROM sale_history WHERE marketplace = 'opensea'").run();
      db.prepare("DELETE FROM pipeline_meta WHERE key = 'os_backfill_complete'").run();
      db.prepare(
        "INSERT OR REPLACE INTO pipeline_meta (key, value, updated_at) VALUES ('os_backfill_uncapped_v4', 'true', datetime('now'))",
      ).run();
      log.info({ cleared: cleared.changes }, 'Cleared OS sales for uncapped re-backfill v4');
    }

    log.info({ path: DB_PATH }, 'Database initialized');
  }
  return db;
}

export function getStmts(): PreparedStatements {
  if (!stmts) getDb();
  return stmts;
}

export function closeDb(): void {
  if (db) {
    db.close();
    log.info('Database closed');
  }
}
