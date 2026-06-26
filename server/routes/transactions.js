import { Router } from 'express';
import { getDb } from '../db.js';
import { getUserConfig, categorizeTransactions } from '../llm.js';

const router = Router();

// List transactions with optional filters
router.get('/', (req, res) => {
  const db = getDb();
  const { limit = 100, offset = 0, search, account_id, bank_name, start_date, end_date, uncategorized, category_id, sort_by = 'posted', sort_dir = 'desc' } = req.query;

  // Whitelist sortable columns to prevent SQL injection
  const allowedSortCols = {
    posted: 't.posted',
    amount: 't.amount',
    description: 't.description',
    account_name: 'a.name',
    bank_name: 'a.bank_name',
    category_name: 'cat.name',
  };
  const orderCol = allowedSortCols[sort_by] || 't.posted';
  const orderDir = sort_dir === 'asc' ? 'ASC' : 'DESC';

  let where = ['c.user_id = ?', '(a.is_hidden IS NULL OR a.is_hidden = 0)'];
  let params = [req.user.userId];

  if (search) {
    // Match either description OR category name (case-insensitive)
    const term = `%${search}%`;
    where.push('(LOWER(t.description) LIKE LOWER(?) OR LOWER(cat.name) LIKE LOWER(?))');
    params.push(term, term);
  }
  if (account_id) {
    where.push('t.account_id = ?');
    params.push(account_id);
  }
  if (bank_name) {
    where.push('(a.bank_name = ? OR c.name = ?)');
    params.push(bank_name, bank_name);
  }
  if (category_id) {
    where.push('cat.id = ?');
    params.push(category_id);
  }
  if (start_date) {
    where.push('t.posted >= ?');
    params.push(start_date);
  }
  if (end_date) {
    where.push('t.posted <= ?');
    params.push(end_date);
  }

  const whereClause = 'WHERE ' + where.join(' AND ');

  const txns = db.prepare(`
    SELECT t.*, a.name as account_name, a.bank_name, c.name as connection_name,
           cat.id as category_id, cat.name as category_name,
           cat.icon as category_icon, cat.color as category_color,
           tc.source as categorization_source, tc.confidence
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    LEFT JOIN transaction_categories tc ON tc.transaction_id = t.id
    LEFT JOIN categories cat ON cat.id = tc.category_id
    ${whereClause}
    ORDER BY ${orderCol} ${orderDir} NULLS LAST, t.id ${orderDir}
    LIMIT ? OFFSET ?
  `).all(...params, Number(limit), Number(offset));

  const count = db.prepare(`
    SELECT COUNT(*) as total FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    LEFT JOIN transaction_categories tc ON tc.transaction_id = t.id
    LEFT JOIN categories cat ON cat.id = tc.category_id
    ${whereClause}
  `).get(...params);

  res.json({ transactions: txns, total: count.total });
});

// Assign category to a single transaction
router.post('/:id/categorize', (req, res) => {
  const { categoryId, source = 'manual', confidence = null } = req.body;
  if (!categoryId) return res.status(400).json({ error: 'categoryId is required' });

  const db = getDb();

  // Verify transaction belongs to this user
  const txn = db.prepare(`
    SELECT t.* FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    WHERE t.id = ? AND c.user_id = ?
  `).get(req.params.id, req.user.userId);

  if (!txn) return res.status(404).json({ error: 'Transaction not found' });

  // Upsert
  db.prepare(`
    INSERT INTO transaction_categories (transaction_id, category_id, source, confidence)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(transaction_id) DO UPDATE SET
      category_id = excluded.category_id,
      source = excluded.source,
      confidence = excluded.confidence
  `).run(req.params.id, categoryId, source, confidence);

  res.json({ success: true });
});

// Bulk assign or clear category for multiple transactions
router.post('/bulk-categorize', (req, res) => {
  const { transaction_ids, category_id } = req.body;
  if (!Array.isArray(transaction_ids) || transaction_ids.length === 0) {
    return res.status(400).json({ error: 'transaction_ids must be a non-empty array' });
  }
  if (category_id !== null && typeof category_id !== 'number') {
    return res.status(400).json({ error: 'category_id must be a number or null' });
  }

  const db = getDb();
  const placeholders = transaction_ids.map(() => '?').join(',');

  // Verify all transactions belong to the current user
  const owned = db.prepare(`
    SELECT t.id FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    WHERE t.id IN (${placeholders}) AND c.user_id = ?
  `).all(...transaction_ids, req.user.userId);

  const ownedIds = owned.map(r => r.id);
  if (ownedIds.length === 0) {
    return res.status(404).json({ error: 'No matching transactions found' });
  }

  const ownedPlaceholders = ownedIds.map(() => '?').join(',');

  if (category_id === null) {
    // Clear categories
    const r = db.prepare(`
      DELETE FROM transaction_categories
      WHERE transaction_id IN (${ownedPlaceholders})
    `).run(...ownedIds);
    return res.json({ success: true, updated: r.changes, cleared: true });
  }

  // Verify the target category belongs to the user
  const cat = db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?')
    .get(category_id, req.user.userId);
  if (!cat) return res.status(404).json({ error: 'Category not found' });

  // Upsert each transaction's category in a single transaction
  const upsert = db.prepare(`
    INSERT INTO transaction_categories (transaction_id, category_id, source, confidence)
    VALUES (?, ?, 'manual', NULL)
    ON CONFLICT(transaction_id) DO UPDATE SET
      category_id = excluded.category_id,
      source = 'manual',
      confidence = NULL
  `);

  let updated = 0;
  const apply = db.transaction((ids) => {
    for (const id of ids) {
      upsert.run(id, category_id);
      updated++;
    }
  });
  apply(ownedIds);

  res.json({ success: true, updated });
});

// Start a categorize job (fire-and-forget)
router.post('/categorize-llm', async (req, res) => {
  const db = getDb();
  const {
    limit = 200,
    scope = 'unassigned',  // unassigned | all | date | accounts | selected
    start_date,
    end_date,
    account_ids,
    transaction_ids,
  } = req.body;

  try {
    // Check if a job is already running for this user
    const running = db.prepare(`
      SELECT id, status FROM categorize_jobs
      WHERE user_id = ? AND status IN ('pending', 'running')
      ORDER BY started_at DESC LIMIT 1
    `).get(req.user.userId);

    if (running) {
      return res.status(409).json({
        error: 'A categorize job is already in progress',
        job_id: running.id,
      });
    }

    const config = await getUserConfig(req.user.userId);
    if (!config) {
      return res.status(400).json({ error: 'LLM not configured. Add your API key in Settings.' });
    }

    // Build WHERE clause based on scope
    let where = ['c.user_id = ?', '(a.is_hidden IS NULL OR a.is_hidden = 0)'];
    const params = [req.user.userId];

    if (scope === 'unassigned') {
      where.push('tc.id IS NULL');
    } else if (scope === 'date') {
      if (start_date) { where.push('t.posted >= ?'); params.push(start_date); }
      if (end_date) { where.push('t.posted <= ?'); params.push(end_date); }
    } else if (scope === 'accounts') {
      if (Array.isArray(account_ids) && account_ids.length > 0) {
        where.push(`a.id IN (${account_ids.map(() => '?').join(',')})`);
        params.push(...account_ids);
      }
    } else if (scope === 'selected') {
      if (Array.isArray(transaction_ids) && transaction_ids.length > 0) {
        where.push(`t.id IN (${transaction_ids.map(() => '?').join(',')})`);
        params.push(...transaction_ids);
      } else {
        return res.json({ job_id: null, message: 'No transactions selected' });
      }
    }
    // scope === 'all' = no extra filter

    const whereClause = 'WHERE ' + where.join(' AND ');

    // Fetch total count
    const total = db.prepare(`
      SELECT COUNT(*) as cnt FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      JOIN connections c ON c.id = a.connection_id
      LEFT JOIN transaction_categories tc ON tc.transaction_id = t.id
      ${whereClause}
    `).get(...params).cnt;

    if (total === 0) {
      return res.json({ job_id: null, message: 'No transactions matched the selected scope' });
    }

    // Create job row
    const jobResult = db.prepare(`
      INSERT INTO categorize_jobs (user_id, status, items_total, started_at)
      VALUES (?, 'pending', ?, datetime('now'))
    `).run(req.user.userId, Math.min(total, Number(limit)));
    const jobId = jobResult.lastInsertRowid;

    res.json({ job_id: jobId, total: Math.min(total, Number(limit)) });

    runCategorizeJob(jobId, req.user.userId, { limit: Number(limit), scope, start_date, end_date, account_ids, transaction_ids }).catch(err => {
      console.error(`[JOB ${jobId}] Failed:`, err);
    });
  } catch (err) {
    console.error('[CATEGORIZE-LLM] Error:', err.message);
    res.status(500).json({ error: 'Failed to start categorize job. Check server logs.' });
  }
});

// Get status of the latest categorize job for the current user
router.get('/categorize-jobs/latest', (req, res) => {
  const db = getDb();
  const job = db.prepare(`
    SELECT * FROM categorize_jobs
    WHERE user_id = ?
    ORDER BY started_at DESC LIMIT 1
  `).get(req.user.userId);

  if (!job) return res.json(null);
  res.json(job);
});

// Get count of uncategorized transactions for the current user
router.get('/uncategorized-count', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT COUNT(*) as cnt FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    LEFT JOIN transaction_categories tc ON tc.transaction_id = t.id
    WHERE c.user_id = ? AND tc.id IS NULL
      AND (a.is_hidden IS NULL OR a.is_hidden = 0)
  `).get(req.user.userId);
  res.json({ count: row.cnt });
});

// Mark a job's "done" banner as dismissed
router.post('/categorize-jobs/:id/dismiss', (req, res) => {
  const db = getDb();
  const result = db.prepare(`
    UPDATE categorize_jobs SET dismissed_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(req.params.id, req.user.userId);
  res.json({ success: result.changes > 0 });
});

// Background job runner — called by POST /categorize-llm
async function runCategorizeJob(jobId, userId, options) {
  const { limit = 200, scope = 'unassigned', start_date, end_date, account_ids, transaction_ids } = options || {};
  const db = getDb();
  try {
    db.prepare(`UPDATE categorize_jobs SET status = 'running' WHERE id = ?`).run(jobId);

    let where = ['c.user_id = ?', '(a.is_hidden IS NULL OR a.is_hidden = 0)'];
    const params = [userId];

    if (scope === 'unassigned') {
      where.push('tc.id IS NULL');
    } else if (scope === 'date') {
      if (start_date) { where.push('t.posted >= ?'); params.push(start_date); }
      if (end_date) { where.push('t.posted <= ?'); params.push(end_date); }
    } else if (scope === 'accounts') {
      if (Array.isArray(account_ids) && account_ids.length > 0) {
        where.push(`a.id IN (${account_ids.map(() => '?').join(',')})`);
        params.push(...account_ids);
      }
    } else if (scope === 'selected') {
      if (Array.isArray(transaction_ids) && transaction_ids.length > 0) {
        where.push(`t.id IN (${transaction_ids.map(() => '?').join(',')})`);
        params.push(...transaction_ids);
      }
    }

    const whereClause = 'WHERE ' + where.join(' AND ');

    const txns = db.prepare(`
      SELECT t.id, t.description, t.amount, t.posted
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      JOIN connections c ON c.id = a.connection_id
      LEFT JOIN transaction_categories tc ON tc.transaction_id = t.id
      ${whereClause}
      ORDER BY t.posted DESC
      LIMIT ?
    `).all(...params, limit);

    if (txns.length === 0) {
      db.prepare(`
        UPDATE categorize_jobs
        SET status = 'done', items_total = 0, items_processed = 0, completed_at = datetime('now')
        WHERE id = ?
      `).run(jobId);
      return;
    }

    const categories = db.prepare('SELECT * FROM categories WHERE user_id = ? ORDER BY name').all(userId);
    const results = await categorizeTransactions(userId, txns, categories);

    const upsert = db.prepare(`
      INSERT INTO transaction_categories (transaction_id, category_id, source, confidence)
      VALUES (?, ?, 'llm', ?)
      ON CONFLICT(transaction_id) DO UPDATE SET
        category_id = excluded.category_id,
        source = 'llm',
        confidence = excluded.confidence
    `);

    let processed = 0;
    const categorize = db.transaction((items) => {
      for (const item of items) {
        upsert.run(item.txnId, item.categoryId, item.confidence);
        processed++;
      }
    });
    categorize(results);

    db.prepare(`
      UPDATE categorize_jobs
      SET status = 'done', items_processed = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(processed, jobId);

    console.log(`[JOB ${jobId}] Done. Scope=${scope}, processed ${processed} of ${txns.length} transactions.`);
  } catch (err) {
    console.error(`[JOB ${jobId}] Failed:`, err.message);
    db.prepare(`
      UPDATE categorize_jobs
      SET status = 'failed', error_message = ?, completed_at = datetime('now')
      WHERE id = ?
    `).run(err.message, jobId);
  }
}

export default router;
