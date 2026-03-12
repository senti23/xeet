import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import { createTables, prepareStatements, type PreparedStatements } from './schema.js';
import { childLogger } from '../lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = childLogger('db');

const DB_PATH = resolve(__dirname, '../../../xeet.db');

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
