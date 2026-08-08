import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, register, seedUserData, api, TEST_PASSWORD } from './helpers.js';

let ctx;
let alice; // { token, user }
let bob;   // { token, user }
let aData; // alice's fixture IDs
let bData; // bob's fixture IDs

before(async () => {
  ctx = await setup();
  alice = await register(ctx, 'alice@example.com', TEST_PASSWORD, 'Alice');
  bob = await register(ctx, 'bob@example.com', TEST_PASSWORD, 'Bob');
  aData = seedUserData(ctx.db, alice.user.id, 'alice');
  bData = seedUserData(ctx.db, bob.user.id, 'bob');
});

after(async () => { await ctx?.close(); });

describe('cross-user isolation', () => {
  it('Bob cannot read Alice account/transaction/category via GET', async () => {
    assert.equal((await api(ctx, 'GET', `/api/accounts/${aData.acctId}/transactions`, { token: bob.token })).status, 404);
    assert.equal((await api(ctx, 'GET', `/api/categories`, { token: bob.token })).data.some(c => c.id === aData.catId), false);
    assert.equal((await api(ctx, 'GET', `/api/transactions?account_id=${aData.acctId}`, { token: bob.token })).data.transactions.length, 0);
  });

  it('Bob cannot mutate Alice resources', async () => {
    assert.equal((await api(ctx, 'PUT', `/api/accounts/${aData.acctId}/name`, { token: bob.token, body: { name: 'hacked' } })).status, 404);
    assert.equal((await api(ctx, 'DELETE', `/api/connections/${aData.connId}`, { token: bob.token })).status, 404);
    assert.equal((await api(ctx, 'DELETE', `/api/categories/${aData.catId}`, { token: bob.token })).status, 404);
    assert.equal((await api(ctx, 'DELETE', `/api/rules/${aData.ruleId}`, { token: bob.token })).status, 404);
  });

  it('Bob cannot categorize his own transaction with Alice category (IDOR)', async () => {
    // bData.txnId belongs to Bob; aData.catId belongs to Alice.
    const res = await api(ctx, 'POST', `/api/transactions/${bData.txnId}/categorize`, {
      token: bob.token,
      body: { categoryId: aData.catId },
    });
    assert.equal(res.status, 404, 'foreign category id must be rejected');
    // Ensure nothing was written.
    const row = ctx.db.prepare('SELECT category_id FROM transaction_categories WHERE transaction_id = ?').get(bData.txnId);
    assert.equal(row, undefined, 'no categorization row should exist');
  });

  it('Bob can categorize his own transaction with his own category', async () => {
    const res = await api(ctx, 'POST', `/api/transactions/${bData.txnId}/categorize`, {
      token: bob.token,
      body: { categoryId: bData.catId },
    });
    assert.equal(res.status, 200);
    const row = ctx.db.prepare('SELECT category_id FROM transaction_categories WHERE transaction_id = ?').get(bData.txnId);
    assert.equal(row.category_id, bData.catId);
  });

  it('Bob cannot create a rule referencing Alice account (account_ids validation)', async () => {
    const res = await api(ctx, 'POST', '/api/rules', {
      token: bob.token,
      body: {
        category_id: bData.catId,
        rule_type: 'keyword',
        match_text: 'Some Merchant',
        account_ids: [aData.acctId],
      },
    });
    assert.equal(res.status, 400, 'rule with a foreign account id must be rejected');
  });

  it('Bob can create a rule referencing his own account', async () => {
    const res = await api(ctx, 'POST', '/api/rules', {
      token: bob.token,
      body: {
        category_id: bData.catId,
        rule_type: 'keyword',
        match_text: 'Some Merchant',
        account_ids: [bData.acctId],
      },
    });
    assert.equal(res.status, 201);
  });

  it('rules list never leaks another user category metadata', async () => {
    // Alice creates a rule pointing at her category; Bob lists his rules only.
    await api(ctx, 'POST', '/api/rules', {
      token: alice.token,
      body: { category_id: aData.catId, rule_type: 'keyword', match_text: 'AliceMerchant' },
    });
    const bRules = (await api(ctx, 'GET', '/api/rules', { token: bob.token })).data;
    for (const r of bRules) {
      assert.notEqual(r.category_id, aData.catId);
      assert.notEqual(r.category_name, 'alice Category');
    }
  });

  it('LLM job cannot be started against another user account/transaction ids', async () => {
    // Give Bob an LLM config pointed at an unreachable local port so any
    // background job fails fast instead of hitting the real network.
    ctx.db.prepare(
      `INSERT INTO user_llm_config (user_id, provider, base_url, api_key, model)
       VALUES (?, 'openai', 'http://127.0.0.1:9/v1', 'fake-key', 'test-model')`
    ).run(bob.user.id);

    // Bob scoping to Alice's account matches nothing (account is not his).
    const foreign = await api(ctx, 'POST', '/api/transactions/categorize-llm', {
      token: bob.token,
      body: { scope: 'accounts', account_ids: [aData.acctId], limit: 10 },
    });
    assert.equal(foreign.status, 200);
    assert.equal(foreign.data.job_id, null, 'foreign account scope should match no transactions');

    // Bob scoping to his own account creates a job owned by Bob.
    const own = await api(ctx, 'POST', '/api/transactions/categorize-llm', {
      token: bob.token,
      body: { scope: 'accounts', account_ids: [bData.acctId], limit: 10 },
    });
    assert.equal(own.status, 200);
    assert.ok(own.data.job_id, 'own account scope should create a job');
    const job = ctx.db.prepare('SELECT * FROM categorize_jobs WHERE id = ?').get(own.data.job_id);
    assert.equal(job.user_id, bob.user.id);
  });

  it('Bob cannot see Alice in /api/auth/me or settings', async () => {
    const me = (await api(ctx, 'GET', '/api/auth/me', { token: bob.token })).data;
    assert.equal(me.id, bob.user.id);
    assert.notEqual(me.email, 'alice@example.com');
  });

  it('receipt detail of another user returns 404 and never leaks its txn', async () => {
    const receiptId = ctx.db.prepare(
      `INSERT INTO receipts (user_id, filename, original_name, amount, matched_transaction_id)
       VALUES (?, 'alice-receipt.jpg', 'a.jpg', 10, ?)`
    ).run(alice.user.id, aData.txnId).lastInsertRowid;
    const res = await api(ctx, 'GET', `/api/receipts/${receiptId}`, { token: bob.token });
    assert.equal(res.status, 404);
  });
});
