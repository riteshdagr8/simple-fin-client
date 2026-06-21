import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'finapp.db');

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      email_verified INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      password_changed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS email_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '📁',
      color TEXT DEFAULT '#666666',
      is_default INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS user_llm_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL DEFAULT 'openai',
      base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
      api_key TEXT NOT NULL,
      model TEXT DEFAULT 'gpt-4o-mini',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      access_url TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_sync_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      simplefin_id TEXT,
      name TEXT NOT NULL,
      bank_name TEXT,
      is_hidden INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      balance REAL,
      balance_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      simplefin_txn_id TEXT,
      posted TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      raw_data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transaction_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      source TEXT DEFAULT 'manual',
      confidence REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(transaction_id)
    );

    -- Dedupe by simplefin_txn_id (was previously the natural key).
    -- Drop the old index if it exists with a different definition, then recreate.
    DROP INDEX IF EXISTS idx_txn_dedupe;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_dedupe
      ON transactions(simplefin_txn_id) WHERE simplefin_txn_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id INTEGER REFERENCES connections(id) ON DELETE SET NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      accounts_synced INTEGER,
      transactions_added INTEGER,
      status TEXT DEFAULT 'in_progress',
      error_message TEXT,
      source TEXT DEFAULT 'manual'  -- 'manual' | 'scheduled'
    );
  `);

  // Migration: add bank_name column to existing accounts table
  const cols = db.prepare("PRAGMA table_info(accounts)").all();
  if (!cols.some(c => c.name === 'bank_name')) {
    db.exec("ALTER TABLE accounts ADD COLUMN bank_name TEXT");
  }
  if (!cols.some(c => c.name === 'is_hidden')) {
    db.exec("ALTER TABLE accounts ADD COLUMN is_hidden INTEGER DEFAULT 0");
  }

  // Migration: add password_changed_at to users (for invalidating old JWTs)
  const userCols = db.prepare("PRAGMA table_info(users)").all();
  if (!userCols.some(c => c.name === 'password_changed_at')) {
    db.exec("ALTER TABLE users ADD COLUMN password_changed_at TEXT");
  }

  // Add UNIQUE index on (connection_id, simplefin_id) to prevent account duplication
  const indexes = db.prepare("PRAGMA index_list(accounts)").all();
  if (!indexes.some(idx => idx.name === 'idx_accounts_unique')) {
    db.exec("CREATE UNIQUE INDEX idx_accounts_unique ON accounts(connection_id, simplefin_id)");
  }

  // Add source column to sync_log if missing
  const logCols = db.prepare("PRAGMA table_info(sync_log)").all();
  if (!logCols.some(c => c.name === 'source')) {
    db.exec("ALTER TABLE sync_log ADD COLUMN source TEXT DEFAULT 'manual'");
  }

  // Per-user sync settings
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      sync_interval_hours INTEGER DEFAULT 2,
      ui_theme TEXT DEFAULT 'minimal',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Add ui_theme column if missing (for existing DBs)
  const settingsCols = db.prepare("PRAGMA table_info(user_settings)").all();
  if (!settingsCols.some(c => c.name === 'ui_theme')) {
    db.exec("ALTER TABLE user_settings ADD COLUMN ui_theme TEXT DEFAULT 'minimal'");
  }

  // Per-user email summary settings
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_summary_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0,
      frequency_hours INTEGER NOT NULL DEFAULT 6,
      include_total_balance INTEGER NOT NULL DEFAULT 1,
      include_per_account_balance INTEGER NOT NULL DEFAULT 1,
      include_per_category_spending INTEGER NOT NULL DEFAULT 1,
      include_todays_transactions INTEGER NOT NULL DEFAULT 1,
      include_weeks_transactions INTEGER NOT NULL DEFAULT 1,
      last_sent_at TEXT,
      next_send_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Categorize jobs (background LLM categorization tracker)
  db.exec(`
    CREATE TABLE IF NOT EXISTS categorize_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
      items_total INTEGER DEFAULT 0,
      items_processed INTEGER DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      error_message TEXT,
      dismissed_at TEXT  -- when user dismissed the "done" banner
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_categorize_jobs_user ON categorize_jobs(user_id, started_at DESC)`);

  // Categorization rules (auto-apply on new transactions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS category_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      rule_type TEXT NOT NULL,           -- 'keyword' | 'history'
      match_text TEXT,                   -- keyword rules: word/phrase to match
      account_ids TEXT,                  -- JSON array of account_ids, or 'all' for any
      patterns TEXT,                     -- history rules: JSON array of extracted patterns
      pattern_threshold REAL DEFAULT 0.6, -- history rules: min % of category txns that must contain pattern
      priority INTEGER DEFAULT 0,        -- higher = evaluated first
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_category_rules_user ON category_rules(user_id, enabled, priority DESC)`);
}
