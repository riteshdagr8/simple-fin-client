import { Router } from 'express';
import { getDb } from '../db.js';
import { exchangeToken, fetchAccounts, SimpleFinAuthError } from '../simplefin.js';
import { canSyncConnection, getStartDateForSync, MAX_SYNCS_PER_DAY } from '../sync-tracker.js';
import { encrypt, decrypt } from '../crypto.js';

const router = Router();

// List all connections for current user
router.get('/', (req, res) => {
  const db = getDb();
  const connections = db.prepare(`
    SELECT c.*, COUNT(a.id) as account_count
    FROM connections c
    LEFT JOIN accounts a ON a.connection_id = c.id
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all(req.user.userId);

  // Add daily sync count for each connection
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const countStmt = db.prepare(`
    SELECT COUNT(*) as cnt FROM sync_log
    WHERE connection_id = ? AND started_at >= ?
  `);
  const enriched = connections.map(c => ({
    ...c,
    syncs_today: countStmt.get(c.id, since).cnt,
    sync_limit: MAX_SYNCS_PER_DAY,
  }));
  res.json(enriched);
});

// Add a new connection (exchange setup token)
router.post('/', async (req, res) => {
  const { name, setupToken } = req.body;
  if (!name || !setupToken) {
    return res.status(400).json({ error: 'name and setupToken are required' });
  }

  try {
    const { accessUrl } = await exchangeToken(setupToken);
    const db = getDb();
    const stmt = db.prepare('INSERT INTO connections (user_id, name, access_url) VALUES (?, ?, ?)');
    // Encrypt the access URL before storing — it contains Basic Auth credentials
    const result = stmt.run(req.user.userId, name, encrypt(accessUrl));

    syncConnection(result.lastInsertRowid, req.user.userId).catch(err => {
      console.error(`Initial sync failed for connection ${result.lastInsertRowid}:`, err.message);
    });

    res.status(201).json({ id: result.lastInsertRowid, name, access_url: accessUrl });
  } catch (err) {
    console.error('Connection setup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete a connection
router.delete('/:id', (req, res) => {
  const db = getDb();
  const conn = db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });
  db.prepare('DELETE FROM connections WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Manual sync for a connection
router.post('/:id/sync', async (req, res) => {
  const db = getDb();
  const conn = db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.userId);
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  // Check rate limit
  const check = canSyncConnection(conn.id);
  if (!check.allowed) {
    return res.status(429).json({
      error: `Daily sync limit reached (${check.count}/${check.limit} in last 24h). SimpleFIN allows max ${MAX_SYNCS_PER_DAY} syncs/day.`,
      count: check.count,
      limit: check.limit,
    });
  }

  res.json({ message: 'Sync started' });
  try {
    await syncConnection(conn.id, req.user.userId, 'manual');
  } catch (err) {
    console.error(`Sync failed for connection ${conn.id}:`, err.message);
  }
});

export async function syncConnection(connectionId, userId, source = 'manual') {
  const db = getDb();
  const conn = db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?')
    .get(connectionId, userId);
  if (!conn) throw new Error('Connection not found');

  // Decrypt the access URL so fetchAccounts can use it
  const accessUrl = decrypt(conn.access_url);

  const now = new Date().toISOString();
  const logEntry = db.prepare(
    'INSERT INTO sync_log (connection_id, started_at, source) VALUES (?, ?, ?)'
  ).run(connectionId, now, source);
  const logId = logEntry.lastInsertRowid;

  try {
    const startDate = getStartDateForSync(conn);

    const data = await fetchAccounts(accessUrl, startDate);

    const upsertAccount = db.prepare(`
      INSERT INTO accounts (connection_id, simplefin_id, name, bank_name, currency, balance, balance_date)
      VALUES (?, ?, ?, ?, ?, ?, datetime(?, 'unixepoch'))
      ON CONFLICT(connection_id, simplefin_id) DO UPDATE SET
        name = excluded.name,
        bank_name = COALESCE(excluded.bank_name, accounts.bank_name),
        balance = excluded.balance,
        balance_date = excluded.balance_date
    `);
    const upsertTxn = db.prepare(`
      INSERT OR IGNORE INTO transactions (account_id, simplefin_txn_id, posted, amount, description, raw_data)
      VALUES (?, ?, datetime(?, 'unixepoch'), ?, ?, ?)
    `);

    let totalAccounts = 0;
    let totalTxns = 0;

    const syncTxn = db.transaction((accounts) => {
      for (const account of accounts) {
        totalAccounts++;
        const bankName = account.org?.name || null;

        const result = upsertAccount.run(
          connectionId,
          account.id || null,
          account.name,
          bankName,
          account.currency || 'USD',
          account.balance,
          account['balance-date'] || Math.floor(Date.now() / 1000)
        );

        const acctRow = db.prepare(
          'SELECT id FROM accounts WHERE simplefin_id = ? AND connection_id = ?'
        ).get(account.id || null, connectionId);
        if (!acctRow) continue;

        for (const txn of account.transactions || []) {
          const txnResult = upsertTxn.run(
            acctRow.id, txn.id || null, txn.posted, txn.amount, txn.description, JSON.stringify(txn)
          );
          if (txnResult.changes > 0) totalTxns++;
        }
      }
    });

    syncTxn(data.accounts);

    const completedAt = new Date().toISOString();
    db.prepare(`
      UPDATE sync_log SET completed_at = ?, status = 'success',
      accounts_synced = ?, transactions_added = ? WHERE id = ?
    `).run(completedAt, totalAccounts, totalTxns, logId);

    db.prepare('UPDATE connections SET last_sync_at = ?, last_error = NULL WHERE id = ?')
      .run(completedAt, connectionId);

    console.log(`Sync complete for connection ${connectionId}: ${totalAccounts} accounts, ${totalTxns} new txns`);

    // Auto-apply categorization rules to new uncategorized transactions
    try {
      const { applyRulesToTransactions } = await import('../rules.js');
      const newTxns = db.prepare(`
        SELECT t.id, t.description, t.amount, t.posted, t.account_id
        FROM transactions t
        JOIN accounts a ON a.id = t.account_id
        LEFT JOIN transaction_categories tc ON tc.transaction_id = t.id
        WHERE a.connection_id = ? AND tc.id IS NULL
      `).all(connectionId);

      if (newTxns.length > 0) {
        const matches = applyRulesToTransactions(userId, newTxns);
        if (matches.length > 0) {
          const upsert = db.prepare(`
            INSERT INTO transaction_categories (transaction_id, category_id, source, confidence)
            VALUES (?, ?, 'rule', ?)
            ON CONFLICT(transaction_id) DO UPDATE SET
              category_id = excluded.category_id,
              source = 'rule',
              confidence = excluded.confidence
          `);
          const apply = db.transaction((items) => {
            for (const m of items) upsert.run(m.transaction_id, m.category_id, m.confidence);
          });
          apply(matches);
          console.log(`[RULES] Auto-categorized ${matches.length} transactions after sync.`);
        }
      }
    } catch (ruleErr) {
      console.error('[RULES] Auto-apply failed:', ruleErr.message);
    }
  } catch (err) {
    const failedAt = new Date().toISOString();
    const isReauth = err instanceof SimpleFinAuthError;

    db.prepare(`
      UPDATE sync_log SET completed_at = ?, status = 'failed', error_message = ? WHERE id = ?
    `).run(failedAt, err.message, logId);

    const errorMsg = isReauth
      ? `Reauthentication required: ${err.message}`
      : err.message;
    db.prepare('UPDATE connections SET last_error = ? WHERE id = ?').run(errorMsg, connectionId);

    if (isReauth) {
      // Send email alert to the user about reauthentication
      try {
        const user = db.prepare('SELECT email, name FROM users WHERE id = ?').get(userId);
        if (user?.email) {
          const { sendMail } = await import('../email.js');
          const conn = db.prepare('SELECT name FROM connections WHERE id = ?').get(connectionId);
          const connName = conn?.name || 'your bank connection';
          const settingsUrl = `${process.env.APP_URL || 'http://localhost:4200'}/#/connections`;
          const html = `
            <div style="font-family: sans-serif; max-width: 600px; margin: auto;">
              <h2 style="color: #dc2626;">⚠️ Bank Connection Needs Reauthentication</h2>
              <p>Hi ${user.name || 'there'},</p>
              <p>Our automated sync for <strong>${connName}</strong> failed with an authentication error. This means SimpleFIN Bridge can no longer access your bank data.</p>
              <p><strong>What to do:</strong> Go to your Connections page and re-add the connection with a fresh setup token from SimpleFIN Bridge.</p>
              <p><a href="${settingsUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;">Go to Connections</a></p>
              <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;">
              <p style="color:#9ca3af;font-size:12px;">Sent by FinApp. <a href="${settingsUrl}">Manage email preferences</a></p>
            </div>`;
          await sendMail(user.email, `Action needed: ${connName} needs reauthentication`, html);
        }
      } catch (emailErr) {
        console.error('[SYNC] Failed to send reauth alert email:', emailErr.message);
      }
    }

    throw err;
  }
}

export default router;
