import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { setup, api } from './helpers.js';

const JWT_SECRET = 'test-only-secret-0123456789abcdef0123456789abcdef';

let ctx;
let counter = 0;

before(async () => {
  ctx = await setup();
});

after(async () => { await ctx?.close(); });

// Create a user row directly and mint a JWT, bypassing the rate-limited
// register endpoint so each test gets an isolated user cheaply.
function newUser() {
  counter++;
  const email = `user${counter}@example.com`;
  const userId = ctx.db.prepare(
    "INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)"
  ).run(email, 'x', `User ${counter}`).lastInsertRowid;
  const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });
  return { token, user: { id: userId, email } };
}

// Create a connection with two accounts for a user.
function seedTransfer(ctx, userId, label) {
  const db = ctx.db;
  const connId = db.prepare(
    "INSERT INTO connections (user_id, name, access_url) VALUES (?, ?, 'enc:test')"
  ).run(userId, `${label} Bank`).lastInsertRowid;
  const acctA = db.prepare(
    "INSERT INTO accounts (connection_id, simplefin_id, name, balance, currency) VALUES (?, ?, ?, ?, ?)"
  ).run(connId, `${label}-a`, `${label} Checking`, 1000, 'CAD').lastInsertRowid;
  const acctB = db.prepare(
    "INSERT INTO accounts (connection_id, simplefin_id, name, balance, currency) VALUES (?, ?, ?, ?, ?)"
  ).run(connId, `${label}-b`, `${label} Savings`, 500, 'CAD').lastInsertRowid;
  return { connId, acctA, acctB };
}

// Insert a transaction with a specific posted date (YYYY-MM-DD HH:MM:SS).
function insertTxn(db, acctId, sfid, posted, amount, description) {
  return db.prepare(
    "INSERT INTO transactions (account_id, simplefin_txn_id, posted, amount, description) VALUES (?, ?, ?, ?, ?)"
  ).run(acctId, sfid, posted, amount, description).lastInsertRowid;
}

describe('transfer reconciliation', () => {
  it('scan auto-pairs a high-confidence opposite-sign same-amount pair', async () => {
    const user = await newUser();
    const { acctA, acctB } = seedTransfer(ctx, user.user.id, 'auto1');
    const debitId = insertTxn(ctx.db, acctA, 'auto1-d', '2026-08-10 09:00:00', -250, 'E-Transfer to Savings');
    const creditId = insertTxn(ctx.db, acctB, 'auto1-c', '2026-08-10 09:02:00', 250, 'E-Transfer from Checking');

    const res = await api(ctx, 'POST', '/api/transfers/scan', { token: user.token });
    assert.equal(res.status, 200);
    assert.equal(res.data.auto_paired, 1, 'should auto-pair the exact match');
    assert.deepEqual(res.data.candidates, [], 'no leftover candidates');

    const pairs = (await api(ctx, 'GET', '/api/transfers', { token: user.token })).data.pairs;
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].debit.id, debitId);
    assert.equal(pairs[0].credit.id, creditId);
    assert.equal(pairs[0].matched_by, 'auto');
  });

  it('scan returns reviewable candidates without pairing them', async () => {
    const user = await newUser();
    const { acctA, acctB } = seedTransfer(ctx, user.user.id, 'cand1');
    // Same amount and same day, but only ONE side clearly says "transfer", so
    // the shared transfer-indicator is below the strong-signal bar → this is a
    // reviewable candidate, not an auto-pair.
    insertTxn(ctx.db, acctA, 'cand1-d', '2026-08-10 09:00:00', -500, 'E-Transfer');
    insertTxn(ctx.db, acctB, 'cand1-c', '2026-08-10 09:01:00', 500, 'Groceries from market');

    const res = await api(ctx, 'POST', '/api/transfers/scan', { token: user.token });
    assert.equal(res.status, 200);
    assert.equal(res.data.auto_paired, 0);
    assert.ok(res.data.candidates.length >= 1, 'reviewable candidate should be returned');
    const pairs = (await api(ctx, 'GET', '/api/transfers', { token: user.token })).data.pairs;
    assert.equal(pairs.length, 0, 'nothing persisted');
  });

  it('excludes same-account, same-sign, and far-date pairs', async () => {
    const user = await newUser();
    const { acctA } = seedTransfer(ctx, user.user.id, 'excl1');
    // Same account (both in acctA) — no pair.
    insertTxn(ctx.db, acctA, 'excl1-s1', '2026-08-10 09:00:00', -100, 'Transfer');
    insertTxn(ctx.db, acctA, 'excl1-s2', '2026-08-10 09:01:00', 100, 'Transfer');
    // Dates 30 days apart — outside the 3-day window.
    const { acctB } = seedTransfer(ctx, user.user.id, 'excl2');
    insertTxn(ctx.db, acctA, 'excl2-d', '2026-07-01 09:00:00', -200, 'E-Transfer');
    insertTxn(ctx.db, acctB, 'excl2-c', '2026-08-10 09:00:00', 200, 'E-Transfer');

    const res = await api(ctx, 'POST', '/api/transfers/scan', { token: user.token });
    assert.equal(res.data.auto_paired, 0);
    assert.deepEqual(res.data.candidates, [], 'no candidates for non-matches');
  });

  it('manually reconciles and persists matched_by=manual', async () => {
    const user = await newUser();
    const { acctA, acctB } = seedTransfer(ctx, user.user.id, 'manual1');
    const debitId = insertTxn(ctx.db, acctA, 'manual1-d', '2026-08-12 10:00:00', -75, 'Bill Payment');
    const creditId = insertTxn(ctx.db, acctB, 'manual1-c', '2026-08-12 10:05:00', 75, 'Online Payment');

    const res = await api(ctx, 'POST', '/api/transfers/pairs', {
      token: user.token,
      body: { debit_txn_id: debitId, credit_txn_id: creditId, matched_by: 'manual', notes: 'test note' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.pair.matched_by, 'manual');
    assert.equal(res.data.pair.notes, 'test note');

    const pairs = (await api(ctx, 'GET', '/api/transfers', { token: user.token })).data.pairs;
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].debit.id, debitId);
    assert.equal(pairs[0].credit.id, creditId);
  });

  it('dashboard excludes both sides after pairing, unpair restores', async () => {
    const user = await newUser();
    const { acctA, acctB } = seedTransfer(ctx, user.user.id, 'dash1');
    const debitId = insertTxn(ctx.db, acctA, 'dash1-d', '2026-08-10 09:00:00', -300, 'E-Transfer to Savings');
    const creditId = insertTxn(ctx.db, acctB, 'dash1-c', '2026-08-10 09:01:00', 300, 'E-Transfer from Checking');

    const before = (await api(ctx, 'GET', '/api/dashboard?period=all', { token: user.token })).data;
    assert.equal(before.totalSpend, 300);

    const ok = await api(ctx, 'POST', '/api/transfers/pairs', {
      token: user.token,
      body: { debit_txn_id: debitId, credit_txn_id: creditId },
    });
    assert.equal(ok.status, 201);

    const after = (await api(ctx, 'GET', '/api/dashboard?period=all', { token: user.token })).data;
    assert.equal(after.totalSpend, 0, 'reconciled transfer removed from total spend');

    const pairId = ok.data.pair.id;
    const del = await api(ctx, 'DELETE', `/api/transfers/pairs/${pairId}`, { token: user.token });
    assert.equal(del.status, 200);
    const restored = (await api(ctx, 'GET', '/api/dashboard?period=all', { token: user.token })).data;
    assert.equal(restored.totalSpend, 300);
  });

  it('cross-user: user A cannot pair user B transaction', async () => {
    const a = await newUser();
    const b = await newUser();
    const { acctA } = seedTransfer(ctx, b.user.id, 'cross1');
    const bDebit = insertTxn(ctx.db, acctA, 'cross1-d', '2026-08-10 09:00:00', -50, 'Transfer');
    const { acctB } = seedTransfer(ctx, a.user.id, 'cross2');
    const aCredit = insertTxn(ctx.db, acctB, 'cross2-c', '2026-08-10 09:01:00', 50, 'Transfer');

    const res = await api(ctx, 'POST', '/api/transfers/pairs', {
      token: a.token,
      body: { debit_txn_id: bDebit, credit_txn_id: aCredit },
    });
    assert.equal(res.status, 404, 'bDebit is not owned by A');
    const pairs = (await api(ctx, 'GET', '/api/transfers', { token: a.token })).data.pairs;
    assert.equal(pairs.length, 0);
    // Bob's debit was not touched by A's attempt.
    const bPairs = (await api(ctx, 'GET', '/api/transfers', { token: b.token })).data.pairs;
    assert.equal(bPairs.length, 0, 'bob has no pairs');
  });

  it('a transaction cannot be paired twice', async () => {
    const user = await newUser();
    const { acctA, acctB } = seedTransfer(ctx, user.user.id, 'dup1');
    const debitId = insertTxn(ctx.db, acctA, 'dup1-d', '2026-08-10 09:00:00', -125, 'E-Transfer');
    const credit1 = insertTxn(ctx.db, acctB, 'dup1-c1', '2026-08-10 09:01:00', 125, 'E-Transfer');
    const credit2 = insertTxn(ctx.db, acctB, 'dup1-c2', '2026-08-10 09:02:00', 125, 'E-Transfer');

    const first = await api(ctx, 'POST', '/api/transfers/pairs', {
      token: user.token,
      body: { debit_txn_id: debitId, credit_txn_id: credit1 },
    });
    assert.equal(first.status, 201);

    const second = await api(ctx, 'POST', '/api/transfers/pairs', {
      token: user.token,
      body: { debit_txn_id: debitId, credit_txn_id: credit2 },
    });
    assert.equal(second.status, 409, 'debit already paired');

    const pairs = (await api(ctx, 'GET', '/api/transfers', { token: user.token })).data.pairs;
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0].credit.id, credit1);
    // credit2 was never paired.
    const stillUnpaired = ctx.db.prepare(
      "SELECT COUNT(*) c FROM transfer_pairs WHERE credit_txn_id = ?"
    ).get(credit2).c;
    assert.equal(stillUnpaired, 0, 'credit2 remains unpaired');
  });

  it('rejects invalid matched_by and missing transactions', async () => {
    const user = await newUser();
    const { acctA, acctB } = seedTransfer(ctx, user.user.id, 'val1');
    const debitId = insertTxn(ctx.db, acctA, 'val1-d', '2026-08-10 09:00:00', -10, 'Transfer');
    const creditId = insertTxn(ctx.db, acctB, 'val1-c', '2026-08-10 09:01:00', 10, 'Transfer');

    const bad = await api(ctx, 'POST', '/api/transfers/pairs', {
      token: user.token,
      body: { debit_txn_id: debitId, credit_txn_id: creditId, matched_by: 'bogus' },
    });
    assert.equal(bad.status, 400);

    const missing = await api(ctx, 'POST', '/api/transfers/pairs', {
      token: user.token,
      body: { debit_txn_id: 999999, credit_txn_id: creditId },
    });
    assert.equal(missing.status, 404);
  });

  it('deleting a transaction cascades the pair away', async () => {
    const user = await newUser();
    const { acctA, acctB } = seedTransfer(ctx, user.user.id, 'casc1');
    const debitId = insertTxn(ctx.db, acctA, 'casc1-d', '2026-08-10 09:00:00', -60, 'Transfer');
    const creditId = insertTxn(ctx.db, acctB, 'casc1-c', '2026-08-10 09:01:00', 60, 'Transfer');

    const pair = await api(ctx, 'POST', '/api/transfers/pairs', {
      token: user.token,
      body: { debit_txn_id: debitId, credit_txn_id: creditId },
    });
    assert.equal(pair.status, 201);

    ctx.db.prepare('DELETE FROM transactions WHERE id = ?').run(debitId);

    const pairs = (await api(ctx, 'GET', '/api/transfers', { token: user.token })).data.pairs;
    const stillThere = pairs.filter(p => p.debit.id === debitId || p.credit.id === debitId);
    assert.equal(stillThere.length, 0, 'pair cascaded away with the transaction');
  });

  it('skips accounts that are hidden (duplicate account copies)', async () => {
    const user = await newUser();
    const { acctA, acctB } = seedTransfer(ctx, user.user.id, 'hid1');
    // Hide the credit-side account — simulates a duplicate joint/secondary
    // account that the user hid.
    ctx.db.prepare('UPDATE accounts SET is_hidden = 1 WHERE id = ?').run(acctB);
    const debitId = insertTxn(ctx.db, acctA, 'hid1-d', '2026-08-10 09:00:00', -250, 'E-Transfer to Savings');
    const creditId = insertTxn(ctx.db, acctB, 'hid1-c', '2026-08-10 09:02:00', 250, 'E-Transfer from Checking');

    const res = await api(ctx, 'POST', '/api/transfers/scan', { token: user.token });
    assert.equal(res.status, 200);
    assert.equal(res.data.auto_paired, 0, 'hidden account must not be auto-paired');
    const candIds = res.data.candidates.flatMap(c => [c.debit.id, c.credit.id]);
    assert.ok(!candIds.includes(debitId) && !candIds.includes(creditId), 'neither side appears as a candidate');
  });

  it('skips candidates where the credit looks like a refund', async () => {
    const user = await newUser();
    const { acctA, acctB } = seedTransfer(ctx, user.user.id, 'ref1');
    // Same amount, same day, but the credit is a refund — not a transfer.
    const debitId = insertTxn(ctx.db, acctA, 'ref1-d', '2026-08-10 09:00:00', -75, 'Grocery Store');
    const creditId = insertTxn(ctx.db, acctB, 'ref1-c', '2026-08-10 09:01:00', 75, 'Refund from Grocery Store');

    const res = await api(ctx, 'POST', '/api/transfers/scan', { token: user.token });
    assert.equal(res.status, 200);
    assert.equal(res.data.auto_paired, 0, 'refund credit must not be auto-paired');
    const candIds = res.data.candidates.flatMap(c => [c.debit.id, c.credit.id]);
    assert.ok(!candIds.includes(debitId) && !candIds.includes(creditId), 'refund pair not suggested');
  });

  it('CSV import auto-pairs a strong-signal transfer pair', async () => {
    const user = await newUser();
    const { acctA, acctB } = seedTransfer(ctx, user.user.id, 'csv1');
    // Import two rows: a debit on acctA and a matching credit on acctB.
    const res = await api(ctx, 'POST', `/api/accounts/${acctA}/transactions/import`, {
      token: user.token,
      body: { rows: [{ posted: '2026-08-10', amount: -120, description: 'E-Transfer to Savings' }] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.imported, 1);

    await api(ctx, 'POST', `/api/accounts/${acctB}/transactions/import`, {
      token: user.token,
      body: { rows: [{ posted: '2026-08-10', amount: 120, description: 'E-Transfer from Checking' }] },
    });

    // The auto-pair should have paired them (strong signal).
    const pairs = (await api(ctx, 'GET', '/api/transfers', { token: user.token })).data.pairs;
    assert.equal(pairs.length, 1, 'imported transfer pair should be auto-paired');
    assert.equal(pairs[0].matched_by, 'auto');
  });
});
