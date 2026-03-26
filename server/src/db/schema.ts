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

    -- Persistent sale history from both marketplaces
    CREATE TABLE IF NOT EXISTS sale_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketplace TEXT NOT NULL CHECK(marketplace IN ('opensea','xeet')),
      token_id TEXT NOT NULL,
      creator_handle TEXT NOT NULL,
      rarity TEXT NOT NULL,
      price REAL NOT NULL,
      currency TEXT NOT NULL,
      price_usd REAL,
      seller TEXT,
      buyer TEXT,
      order_hash TEXT,
      tx_hash TEXT,
      sold_at TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_dedup ON sale_history(marketplace, token_id, tx_hash, price);
    CREATE INDEX IF NOT EXISTS idx_sale_creator ON sale_history(creator_handle, rarity, sold_at);
    CREATE INDEX IF NOT EXISTS idx_sale_token ON sale_history(token_id, sold_at);

    -- Current NFT holders (reconstructed from on-chain transfer events)
    CREATE TABLE IF NOT EXISTS card_holders (
      wallet_address TEXT NOT NULL,
      token_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      creator_handle TEXT NOT NULL,
      rarity TEXT NOT NULL CHECK(rarity IN ('common','rare','legendary')),
      last_updated TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (wallet_address, token_id)
    );
    CREATE INDEX IF NOT EXISTS idx_holders_wallet ON card_holders(wallet_address);
    CREATE INDEX IF NOT EXISTS idx_holders_token ON card_holders(token_id);
    CREATE INDEX IF NOT EXISTS idx_holders_creator ON card_holders(creator_handle, rarity);

    -- Holder sync metadata (tracks last synced block, backfill progress)
    CREATE TABLE IF NOT EXISTS holder_sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Pipeline metadata (tracks backfill completion, cursors, etc.)
    CREATE TABLE IF NOT EXISTS pipeline_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
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

  // Sale history
  upsertSale: Database.Statement;
  getLastSaleByCreatorRarity: Database.Statement;
  getSalesByToken: Database.Statement;
  getSalesByCreatorRarity: Database.Statement;
  getLatestSaleTimestamp: Database.Statement;

  // Card holders
  upsertHolder: Database.Statement;
  deleteHoldersByToken: Database.Statement;
  deleteAllHolders: Database.Statement;
  getHoldersByWallet: Database.Statement;
  getHoldersByToken: Database.Statement;
  getTopWallets: Database.Statement;
  getHolderCount: Database.Statement;
  getAllHolders: Database.Statement;

  // Holder sync meta
  upsertSyncMeta: Database.Statement;
  getSyncMeta: Database.Statement;

  // Pipeline meta
  upsertPipelineMeta: Database.Statement;
  getPipelineMeta: Database.Statement;
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

    // Sale history
    upsertSale: db.prepare(`
      INSERT OR IGNORE INTO sale_history (marketplace, token_id, creator_handle, rarity, price, currency, price_usd, seller, buyer, order_hash, tx_hash, sold_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getLastSaleByCreatorRarity: db.prepare(`
      SELECT * FROM sale_history WHERE creator_handle = ? AND rarity = ? AND marketplace = ?
      ORDER BY sold_at DESC LIMIT 1
    `),
    getSalesByToken: db.prepare(
      'SELECT * FROM sale_history WHERE token_id = ? ORDER BY sold_at DESC',
    ),
    getSalesByCreatorRarity: db.prepare(
      'SELECT * FROM sale_history WHERE creator_handle = ? AND rarity = ? ORDER BY sold_at DESC',
    ),
    getLatestSaleTimestamp: db.prepare(
      'SELECT MAX(sold_at) as latest FROM sale_history WHERE marketplace = ?',
    ),

    // Card holders
    upsertHolder: db.prepare(`
      INSERT INTO card_holders (wallet_address, token_id, quantity, creator_handle, rarity, last_updated)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(wallet_address, token_id) DO UPDATE SET
        quantity = excluded.quantity,
        last_updated = datetime('now')
    `),
    deleteHoldersByToken: db.prepare('DELETE FROM card_holders WHERE token_id = ?'),
    deleteAllHolders: db.prepare('DELETE FROM card_holders'),
    getHoldersByWallet: db.prepare(
      'SELECT * FROM card_holders WHERE wallet_address = ? ORDER BY creator_handle, rarity',
    ),
    getHoldersByToken: db.prepare(
      'SELECT * FROM card_holders WHERE token_id = ? ORDER BY quantity DESC',
    ),
    getTopWallets: db.prepare(`
      SELECT wallet_address,
        COUNT(DISTINCT token_id) as unique_cards,
        SUM(quantity) as total_cards,
        COUNT(DISTINCT creator_handle) as unique_creators
      FROM card_holders
      GROUP BY wallet_address
      ORDER BY unique_creators DESC, total_cards DESC
      LIMIT ?
    `),
    getHolderCount: db.prepare(
      'SELECT COUNT(DISTINCT wallet_address) as count FROM card_holders',
    ),
    getAllHolders: db.prepare(
      'SELECT wallet_address, token_id, quantity, creator_handle, rarity FROM card_holders WHERE quantity > 0',
    ),

    // Holder sync meta
    upsertSyncMeta: db.prepare(`
      INSERT INTO holder_sync_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),
    getSyncMeta: db.prepare('SELECT value FROM holder_sync_meta WHERE key = ?'),

    // Pipeline meta
    upsertPipelineMeta: db.prepare(`
      INSERT INTO pipeline_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `),
    getPipelineMeta: db.prepare('SELECT value FROM pipeline_meta WHERE key = ?'),
  };
}
