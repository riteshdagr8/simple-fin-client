import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { connection_id, include_hidden } = req.query;
  let query = `
    SELECT a.*, c.name as connection_name
    FROM accounts a
    JOIN connections c ON c.id = a.connection_id
    WHERE c.user_id = ?
  `;
  const params = [req.user.userId];
  if (connection_id) {
    query += ' AND a.connection_id = ?';
    params.push(connection_id);
  }
  if (include_hidden !== 'true') {
    query += ' AND (a.is_hidden IS NULL OR a.is_hidden = 0)';
  }
  query += ' ORDER BY a.created_at DESC';
  const accounts = db.prepare(query).all(...params);
  // Map bank_name to use connection_name as fallback
  res.json(accounts.map(a => ({ ...a, bank_name: a.bank_name || a.connection_name })));
});

router.put('/:id/bank-name', (req, res) => {
  const db = getDb();
  const { bank_name } = req.body;

  const account = db.prepare(`
    SELECT a.* FROM accounts a
    JOIN connections c ON c.id = a.connection_id
    WHERE a.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.userId);

  if (!account) return res.status(404).json({ error: 'Account not found' });

  db.prepare('UPDATE accounts SET bank_name = ? WHERE id = ?').run(bank_name, req.params.id);
  res.json({ success: true });
});

router.put('/:id/name', (req, res) => {
  const db = getDb();
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });

  const account = db.prepare(`
    SELECT a.* FROM accounts a
    JOIN connections c ON c.id = a.connection_id
    WHERE a.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.userId);

  if (!account) return res.status(404).json({ error: 'Account not found' });

  db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  res.json({ success: true });
});

router.put('/:id/hidden', (req, res) => {
  const db = getDb();
  const { is_hidden } = req.body;

  const account = db.prepare(`
    SELECT a.* FROM accounts a
    JOIN connections c ON c.id = a.connection_id
    WHERE a.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.userId);

  if (!account) return res.status(404).json({ error: 'Account not found' });

  db.prepare('UPDATE accounts SET is_hidden = ? WHERE id = ?').run(is_hidden ? 1 : 0, req.params.id);
  res.json({ success: true });
});

router.put('/bulk-bank-name', (req, res) => {
  const db = getDb();
  const { updates } = req.body; // [{ id, bank_name }]

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'updates array is required' });
  }

  const updateStmt = db.prepare('UPDATE accounts SET bank_name = ? WHERE id = ?');
  const verifyStmt = db.prepare(`
    SELECT a.id FROM accounts a
    JOIN connections c ON c.id = a.connection_id
    WHERE a.id = ? AND c.user_id = ?
  `);

  let updated = 0;
  const renameTxn = db.transaction((items) => {
    for (const item of items) {
      if (!item.id || typeof item.bank_name !== 'string') continue;
      const account = verifyStmt.get(item.id, req.user.userId);
      if (!account) continue;
      updateStmt.run(item.bank_name.trim() || null, item.id);
      updated++;
    }
  });
  renameTxn(updates);

  res.json({ success: true, updated });
});

router.put('/bulk-name', (req, res) => {
  const db = getDb();
  const { updates } = req.body; // [{ id, name }]

  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'updates array is required' });
  }

  const updateStmt = db.prepare('UPDATE accounts SET name = ? WHERE id = ?');
  const verifyStmt = db.prepare(`
    SELECT a.id FROM accounts a
    JOIN connections c ON c.id = a.connection_id
    WHERE a.id = ? AND c.user_id = ?
  `);

  let updated = 0;
  const renameTxn = db.transaction((items) => {
    for (const item of items) {
      if (!item.id || !item.name || typeof item.name !== 'string') continue;
      const account = verifyStmt.get(item.id, req.user.userId);
      if (!account) continue;
      updateStmt.run(item.name.trim(), item.id);
      updated++;
    }
  });
  renameTxn(updates);

  res.json({ success: true, updated });
});

router.get('/:id/transactions', (req, res) => {
  const db = getDb();
  const { limit = 100, offset = 0 } = req.query;

  const account = db.prepare(`
    SELECT a.* FROM accounts a
    JOIN connections c ON c.id = a.connection_id
    WHERE a.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.userId);

  if (!account) return res.status(404).json({ error: 'Account not found' });

  const txns = db.prepare(`
    SELECT t.*, cat.id as category_id, cat.name as category_name, cat.icon as category_icon, cat.color as category_color
    FROM transactions t
    LEFT JOIN transaction_categories tc ON tc.transaction_id = t.id
    LEFT JOIN categories cat ON cat.id = tc.category_id
    WHERE t.account_id = ?
    ORDER BY t.posted DESC
    LIMIT ? OFFSET ?
  `).all(req.params.id, Number(limit), Number(offset));

  const count = db.prepare('SELECT COUNT(*) as total FROM transactions WHERE account_id = ?')
    .get(req.params.id);
  res.json({ transactions: txns, total: count.total });
});

export default router;
