import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { setup, api } from './helpers.js';

const JWT_SECRET = 'test-only-secret-0123456789abcdef0123456789abcdef';

let ctx;
let counter = 0;

before(async () => { ctx = await setup(); });
after(async () => { await ctx?.close(); });

// Create a user row directly + JWT, same as the transfers tests.
function newUser() {
  counter++;
  const email = `dash${counter}@example.com`;
  const userId = ctx.db.prepare(
    "INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)"
  ).run(email, 'x', `Dash ${counter}`).lastInsertRowid;
  return { token: jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' }), user: { id: userId } };
}

function seedAccounts(db, userId, label) {
  const connId = db.prepare("INSERT INTO connections (user_id, name, access_url) VALUES (?, ?, 'enc:x')").run(userId, `${label} Bank`).lastInsertRowid;
  const acctA = db.prepare("INSERT INTO accounts (connection_id, simplefin_id, name, currency) VALUES (?, ?, ?, 'CAD')").run(connId, `${label}-a`, `${label} Checking`).lastInsertRowid;
  return acctA;
}

function insertTxn(db, acctId, sfid, posted, amount, description) {
  return db.prepare("INSERT INTO transactions (account_id, simplefin_txn_id, posted, amount, description) VALUES (?, ?, ?, ?, ?)")
    .run(acctId, sfid, posted, amount, description).lastInsertRowid;
}

describe('dashboard spending', () => {
  it('category list includes Uncategorized and reconciles with totalSpend', async () => {
    const user = await newUser();
    const acct = seedAccounts(ctx.db, user.user.id, 'd1');

    // A categorized debit.
    const catId = ctx.db.prepare('INSERT INTO categories (user_id, name, icon, color) VALUES (?, ?, ?, ?)')
      .run(user.user.id, 'Groceries', '🛒', '#22c55e').lastInsertRowid;
    const catTxn = insertTxn(ctx.db, acct, 'd1-cat', '2026-08-10 12:00:00', -100, 'Grocery Store');
    ctx.db.prepare('INSERT INTO transaction_categories (transaction_id, category_id, source) VALUES (?, ?, ?)')
      .run(catTxn, catId, 'manual');

    // An uncategorized debit.
    insertTxn(ctx.db, acct, 'd1-uncat', '2026-08-10 12:00:00', -250, 'Unknown Purchase');

    const res = await api(ctx, 'GET', '/api/dashboard?period=all', { token: user.token });
    assert.equal(res.status, 200);
    assert.equal(res.data.totalSpend, 350, 'total spend = 100 + 250');

    const cat = res.data.categorySpending;
    const uncat = cat.find(c => c.id === 'uncategorized');
    assert.ok(uncat, 'uncategorized entry present');
    assert.equal(Math.abs(uncat.total), 250, 'uncategorized amount is correct');

    const sum = cat.reduce((s, c) => s + Math.abs(c.total), 0);
    assert.ok(Math.abs(sum - res.data.totalSpend) < 0.01, 'category list reconciles with totalSpend');
  });

  it('no Uncategorized entry when everything is categorized', async () => {
    const user = await newUser();
    const acct = seedAccounts(ctx.db, user.user.id, 'd2');
    const catId = ctx.db.prepare('INSERT INTO categories (user_id, name) VALUES (?, ?)')
      .run(user.user.id, 'Income').lastInsertRowid;
    const txn = insertTxn(ctx.db, acct, 'd2-t', '2026-08-10 12:00:00', -60, 'Deposit');
    ctx.db.prepare('INSERT INTO transaction_categories (transaction_id, category_id, source) VALUES (?, ?, ?)')
      .run(txn, catId, 'manual');

    const res = await api(ctx, 'GET', '/api/dashboard?period=all', { token: user.token });
    const uncat = res.data.categorySpending.find(c => c.id === 'uncategorized');
    assert.equal(uncat, undefined, 'no uncategorized entry when nothing is uncategorized');
  });
});
