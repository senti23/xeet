import type Database from 'better-sqlite3';

export function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_map (
      token_id TEXT PRIMARY KEY,
      creator_handle TEXT NOT NULL,
      rarity TEXT NOT NULL CHECK(rarity IN ('common','rare','legendary')),
      name TEXT,
      image_url TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_token_map_creator ON token_map(creator_handle, rarity);

    CREATE TABLE IF NOT EXISTS bot_users (
      telegram_id INTEGER PRIMARY KEY,
      username TEXT,
      activated_at TEXT,
      invite_code TEXT
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      redeemed_by INTEGER REFERENCES bot_users(telegram_id),
      redeemed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER NOT NULL REFERENCES bot_users(telegram_id),
      creator_handle TEXT NOT NULL,
      rarity TEXT NOT NULL CHECK(rarity IN ('common','rare','legendary')),
      max_price_eth REAL,
      max_price_xeets REAL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_subs_active ON subscriptions(active, creator_handle, rarity);

    CREATE TABLE IF NOT EXISTS alert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
      order_hash TEXT NOT NULL,
      price TEXT NOT NULL,
      marketplace TEXT NOT NULL CHECK(marketplace IN ('opensea','xeet')),
      alerted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_dedup ON alert_history(subscription_id, order_hash, price);
  `);
}

export interface PreparedStatements {
  // Token map
  upsertToken: Database.Statement;
  getTokensByCreator: Database.Statement;
  getCreatorByToken: Database.Statement;
  getAllTokens: Database.Statement;

  // Invite codes
  insertInviteCode: Database.Statement;
  getInviteCode: Database.Statement;
  redeemInviteCode: Database.Statement;

  // Bot users
  upsertBotUser: Database.Statement;
  getBotUser: Database.Statement;

  // Subscriptions
  insertSubscription: Database.Statement;
  deactivateSubscription: Database.Statement;
  deactivateAllSubscriptions: Database.Statement;
  getActiveSubscriptions: Database.Statement;
  getUserSubscriptions: Database.Statement;
  getMatchingSubscriptions: Database.Statement;

  // Alert history
  insertAlertHistory: Database.Statement;
  checkAlertExists: Database.Statement;
}

export function prepareStatements(db: Database.Database): PreparedStatements {
  return {
    // Token map
    upsertToken: db.prepare(`
      INSERT INTO token_map (token_id, creator_handle, rarity, name, image_url)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(token_id) DO UPDATE SET
        creator_handle = excluded.creator_handle,
        rarity = excluded.rarity,
        name = excluded.name,
        image_url = excluded.image_url
    `),
    getTokensByCreator: db.prepare(
      'SELECT * FROM token_map WHERE creator_handle = ? AND rarity = ?',
    ),
    getCreatorByToken: db.prepare('SELECT * FROM token_map WHERE token_id = ?'),
    getAllTokens: db.prepare('SELECT * FROM token_map'),

    // Invite codes
    insertInviteCode: db.prepare(
      'INSERT OR IGNORE INTO invite_codes (code) VALUES (?)',
    ),
    getInviteCode: db.prepare(
      'SELECT * FROM invite_codes WHERE code = ? AND redeemed_by IS NULL',
    ),
    redeemInviteCode: db.prepare(
      `UPDATE invite_codes SET redeemed_by = ?, redeemed_at = datetime('now') WHERE code = ? AND redeemed_by IS NULL`,
    ),

    // Bot users
    upsertBotUser: db.prepare(`
      INSERT INTO bot_users (telegram_id, username, activated_at, invite_code)
      VALUES (?, ?, datetime('now'), ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        activated_at = excluded.activated_at,
        invite_code = excluded.invite_code
    `),
    getBotUser: db.prepare('SELECT * FROM bot_users WHERE telegram_id = ?'),

    // Subscriptions
    insertSubscription: db.prepare(`
      INSERT INTO subscriptions (telegram_id, creator_handle, rarity, max_price_eth, max_price_xeets)
      VALUES (?, ?, ?, ?, ?)
    `),
    deactivateSubscription: db.prepare(
      'UPDATE subscriptions SET active = 0 WHERE id = ? AND telegram_id = ?',
    ),
    deactivateAllSubscriptions: db.prepare(
      'UPDATE subscriptions SET active = 0 WHERE telegram_id = ? AND active = 1',
    ),
    getActiveSubscriptions: db.prepare(
      'SELECT * FROM subscriptions WHERE active = 1',
    ),
    getUserSubscriptions: db.prepare(
      'SELECT * FROM subscriptions WHERE telegram_id = ? AND active = 1',
    ),
    getMatchingSubscriptions: db.prepare(
      'SELECT * FROM subscriptions WHERE active = 1 AND creator_handle = ? AND rarity = ?',
    ),

    // Alert history
    insertAlertHistory: db.prepare(`
      INSERT OR IGNORE INTO alert_history (subscription_id, order_hash, price, marketplace)
      VALUES (?, ?, ?, ?)
    `),
    checkAlertExists: db.prepare(
      'SELECT 1 FROM alert_history WHERE subscription_id = ? AND order_hash = ? AND price = ?',
    ),
  };
}
