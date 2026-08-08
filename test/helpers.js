// Test helpers — no top-level side effects. `setup()` is called by test files
// (top-level await) and configures a fresh temp DB + ephemeral HTTP server.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const TEST_PASSWORD = 'Password123!';
const JWT_SECRET = 'test-only-secret-0123456789abcdef0123456789abcdef'; // 40 chars
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64 hex

export async function setup() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.CORS_ORIGIN = 'http://localhost:3000';
  const dir = await mkdtemp(path.join(os.tmpdir(), 'finapp-test-'));
  process.env.DB_PATH = path.join(dir, 'test.db');
  process.env.DATA_DIR = dir;

  // Dynamic import so the env vars above are set before the server modules load.
  const { createApp } = await import('../server/app.js');
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { getDb } = await import('../server/db.js');
  const db = getDb();

  return {
    base,
    server,
    db,
    dir,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      try { db.close(); } catch { /* already closed */ }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function register(ctx, email, password = TEST_PASSWORD, name = 'Test User') {
  const res = await fetch(`${ctx.base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`register failed: ${res.status} ${JSON.stringify(body)}`);
  return body; // { token, user }
}

export async function login(ctx, email, password = TEST_PASSWORD) {
  const res = await fetch(`${ctx.base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login failed: ${res.status} ${JSON.stringify(body)}`);
  return body; // { token, user }
}

export function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export async function api(ctx, method, pathname, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${ctx.base}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// Insert a full fixture tree (connection + account + transaction + category +
// keyword rule) for a user, returning the created IDs. Tests create their own
// rows so the cross-user matrix can be exercised without any external network
// calls.
export function seedUserData(db, userId, label) {
  const connId = db.prepare(
    "INSERT INTO connections (user_id, name, access_url) VALUES (?, ?, 'enc:test')"
  ).run(userId, `${label} Bank`).lastInsertRowid;
  const acctId = db.prepare(
    "INSERT INTO accounts (connection_id, simplefin_id, name, balance) VALUES (?, ?, ?, ?)"
  ).run(connId, `${label}-acct`, `${label} Checking`, 1000).lastInsertRowid;
  const txnId = db.prepare(
    "INSERT INTO transactions (account_id, simplefin_txn_id, posted, amount, description) VALUES (?, ?, datetime('now'), -10, ?)"
  ).run(acctId, `${label}-txn-1`, `${label} Merchant`).lastInsertRowid;
  const catId = db.prepare(
    'INSERT INTO categories (user_id, name) VALUES (?, ?)'
  ).run(userId, `${label} Category`).lastInsertRowid;
  const ruleId = db.prepare(
    `INSERT INTO category_rules (user_id, category_id, rule_type, match_text, account_ids, patterns, pattern_threshold, priority, enabled)
     VALUES (?, ?, 'keyword', ?, 'all', '[]', 0.6, 0, 1)`
  ).run(userId, catId, `${label}Merchant`).lastInsertRowid;
  return { connId, acctId, txnId, catId, ruleId };
}
