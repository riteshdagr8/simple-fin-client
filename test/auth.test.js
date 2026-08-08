import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, register, login, api, TEST_PASSWORD } from './helpers.js';

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx?.close(); });

describe('auth', () => {
  it('registers a user and returns a working token', async () => {
    const res = await register(ctx, 'alice@example.com', TEST_PASSWORD, 'Alice');
    assert.ok(res.token, 'token issued');
    assert.equal(res.user.email, 'alice@example.com');
    const me = await api(ctx, 'GET', '/api/auth/me', { token: res.token });
    assert.equal(me.status, 200);
    assert.equal(me.data.email, 'alice@example.com');
  });

  it('rejects duplicate registration', async () => {
    await register(ctx, 'dup@example.com', TEST_PASSWORD);
    const res = await fetch(`${ctx.base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Dup', email: 'dup@example.com', password: TEST_PASSWORD }),
    });
    assert.equal(res.status, 409);
  });

  it('logs in with correct credentials and rejects wrong password', async () => {
    await register(ctx, 'bob@example.com', TEST_PASSWORD);
    const ok = await login(ctx, 'bob@example.com', TEST_PASSWORD);
    assert.ok(ok.token);

    const bad = await fetch(`${ctx.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bob@example.com', password: 'WrongPass123!' }),
    });
    assert.equal(bad.status, 401);
  });

  it('rejects protected routes without a token', async () => {
    const res = await api(ctx, 'GET', '/api/categories');
    assert.equal(res.status, 401);
  });

  it('rejects a garbage token', async () => {
    const res = await api(ctx, 'GET', '/api/categories', { token: 'not-a-real-token' });
    assert.equal(res.status, 401);
  });

  it('invalidates tokens issued before a password change', async () => {
    const user = await register(ctx, 'carol@example.com', TEST_PASSWORD);
    const oldToken = user.token;
    const db = ctx.db;

    // The forgot-password flow generates a token and emails it; emulate that by
    // inserting a valid reset token directly.
    const token = 'reset-token-for-carol-0123456789abcdef';
    db.prepare(
      `INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))`
    ).run(user.user.id, token);

    const reset = await api(ctx, 'POST', '/api/auth/reset-password', {
      body: { token, password: 'NewPassword456!' },
    });
    assert.equal(reset.status, 200);

    // The route stores second-precision timestamps, so a reset in the same
    // wall-clock second as the token's issuance would not strictly be "after"
    // it. Nudge the timestamp forward so the stale check is deterministic.
    ctx.db.prepare("UPDATE users SET password_changed_at = datetime('now', '+2 seconds') WHERE id = ?")
      .run(user.user.id);

    // Old JWT was issued before password_changed_at → now rejected.
    const me = await api(ctx, 'GET', '/api/auth/me', { token: oldToken });
    assert.equal(me.status, 401);

    // New password works.
    const relogin = await login(ctx, 'carol@example.com', 'NewPassword456!');
    assert.ok(relogin.token);
  });
});
