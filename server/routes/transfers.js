import { Router } from 'express';
import { getDb } from '../db.js';
import {
  findTransferCandidates,
  validatePair,
  DEFAULT_WINDOW_DAYS,
  DEFAULT_MIN_SCORE,
} from '../transfers.js';

const router = Router();

// Expand a pair row into { debit, credit, ...pair } with account names.
function expandPair(db, pair) {
  const txn = db.prepare(`
    SELECT t.id, t.account_id, t.amount, t.posted, t.description,
           a.name as account_name
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.id = ?
  `);
  return {
    ...pair,
    debit: txn.get(pair.debit_txn_id),
    credit: txn.get(pair.credit_txn_id),
  };
}

// List reconciled pairs for the current user.
router.get('/', (req, res) => {
  const db = getDb();
  const pairs = db.prepare(`
    SELECT * FROM transfer_pairs
    WHERE user_id = ?
    ORDER BY matched_at DESC, id DESC
  `).all(req.user.userId);
  res.json({ pairs: pairs.map(p => expandPair(db, p)) });
});

// Reviewable candidates (those that should not be auto-paired).
router.get('/candidates', (req, res) => {
  const db = getDb();
  const windowDays = Number(req.query.window_days) || DEFAULT_WINDOW_DAYS;
  const minScore = req.query.min_score !== undefined ? Number(req.query.min_score) : DEFAULT_MIN_SCORE;
  const all = findTransferCandidates(db, req.user.userId, { windowDays, minScore });
  const candidates = all.filter(c => !c.strongSignal);
  res.json({ candidates });
});

// Scan: auto-pair strong-signal transfers, return the rest for review.
router.post('/scan', (req, res) => {
  const db = getDb();
  const windowDays = Number(req.body?.window_days) || DEFAULT_WINDOW_DAYS;
  const minScore = req.body?.min_score !== undefined ? Number(req.body.min_score) : DEFAULT_MIN_SCORE;

  const all = findTransferCandidates(db, req.user.userId, { windowDays, minScore });
  const toAutoPair = all.filter(c => c.strongSignal);
  const candidates = all.filter(c => !c.strongSignal);

  let autoPaired = 0;
  const insert = db.prepare(`
    INSERT INTO transfer_pairs (user_id, debit_txn_id, credit_txn_id, matched_by)
    VALUES (?, ?, ?, 'auto')
  `);
  const doPair = db.transaction((items) => {
    for (const c of items) {
      const existing = db.prepare(`
        SELECT id FROM transfer_pairs
        WHERE debit_txn_id = ? OR credit_txn_id = ?
           OR debit_txn_id = ? OR credit_txn_id = ?
      `).get(c.debit.id, c.debit.id, c.credit.id, c.credit.id);
      if (existing) continue;
      insert.run(req.user.userId, c.debit.id, c.credit.id);
      autoPaired++;
    }
  });
  doPair(toAutoPair);

  res.json({
    scanned_at: new Date().toISOString(),
    auto_paired: autoPaired,
    candidates,
  });
});

// Manually reconcile (or create an explicit pair for any two transactions).
router.post('/pairs', (req, res) => {
  const db = getDb();
  const { debit_txn_id, credit_txn_id, matched_by = 'manual', notes } = req.body || {};

  const valid = validatePair(db, req.user.userId, debit_txn_id, credit_txn_id);
  if (!valid.ok) return res.status(valid.status).json({ error: valid.error });

  if (matched_by !== 'manual' && matched_by !== 'auto') {
    return res.status(400).json({ error: 'matched_by must be "manual" or "auto"' });
  }

  const result = db.prepare(`
    INSERT INTO transfer_pairs (user_id, debit_txn_id, credit_txn_id, matched_by, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    req.user.userId,
    valid.debit.id,
    valid.credit.id,
    matched_by,
    notes ? String(notes).slice(0, 500) : null
  );

  const pair = db.prepare('SELECT * FROM transfer_pairs WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ pair: expandPair(db, pair) });
});

// Unpair.
router.delete('/pairs/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM transfer_pairs WHERE id = ? AND user_id = ?')
    .run(Number(req.params.id), req.user.userId);
  if (result.changes === 0) return res.status(404).json({ error: 'Pair not found' });
  res.json({ deleted: true, id: Number(req.params.id) });
});

export default router;
