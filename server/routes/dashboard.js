import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

function getPeriodWhere(period, start_date, end_date) {
  if (period === 'month') {
    return { where: "AND t.posted >= datetime('now', 'start of month')", params: [] };
  } else if (period === 'year') {
    return { where: "AND t.posted >= datetime('now', 'start of year')", params: [] };
  } else if (period === 'last30') {
    return { where: "AND t.posted >= datetime('now', '-30 days')", params: [] };
  } else if (period === 'all') {
    return { where: '', params: [] };
  } else if (period === 'custom' && start_date && end_date) {
    return { where: 'AND t.posted >= ? AND t.posted <= ?', params: [start_date, end_date] };
  }
  return { where: "AND t.posted >= datetime('now', '-30 days')", params: [] };
}

router.get('/', (req, res) => {
  const db = getDb();
  const uid = req.user.userId;

  // Default to last 30 days
  const { period = 'last30', start_date, end_date } = req.query;
  const { where: dateWhere, params: dateParams } = getPeriodWhere(period, start_date, end_date);

  const balances = db.prepare(`
    SELECT COALESCE(SUM(a.balance), 0) as total_balance, COUNT(DISTINCT a.id) as account_count
    FROM accounts a
    JOIN connections c ON c.id = a.connection_id
    WHERE c.user_id = ? AND (a.is_hidden IS NULL OR a.is_hidden = 0)
  `).get(uid);

  // Recent transactions — uses the same period filter as spending
  const periodTxns = db.prepare(`
    SELECT t.*, a.name as account_name, c.name as connection_name,
           cat.name as category_name, cat.icon as category_icon, cat.color as category_color
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    LEFT JOIN transaction_categories tc ON tc.transaction_id = t.id
    LEFT JOIN categories cat ON cat.id = tc.category_id
    WHERE c.user_id = ? AND (a.is_hidden IS NULL OR a.is_hidden = 0)
      ${dateWhere.replace('AND ', 'AND ')}
    ORDER BY t.posted DESC
    LIMIT 20
  `).all(uid, ...dateParams);

  const lastSync = db.prepare(`
    SELECT sl.*, c.name as connection_name
    FROM sync_log sl
    JOIN connections c ON c.id = sl.connection_id
    WHERE c.user_id = ?
    ORDER BY sl.started_at DESC
    LIMIT 5
  `).all(uid);

  const connections = db.prepare(`
    SELECT id, name, last_sync_at, last_error,
           CASE WHEN last_error IS NULL AND last_sync_at IS NOT NULL THEN 'healthy'
                WHEN last_error IS NOT NULL THEN 'error'
                ELSE 'pending'
           END as status
    FROM connections WHERE user_id = ?
    ORDER BY name
  `).all(uid);

  // Spending by category (only includes transactions with a category)
  const categorySpending = db.prepare(`
    SELECT cat.id, cat.name, cat.icon, cat.color,
           COALESCE(SUM(t.amount), 0) as total
    FROM categories cat
    LEFT JOIN transaction_categories tc ON tc.category_id = cat.id
    LEFT JOIN transactions t ON t.id = tc.transaction_id
      AND t.amount < 0
      ${dateWhere}
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE cat.user_id = ?
      AND (a.id IS NULL OR (a.is_hidden IS NULL OR a.is_hidden = 0))
    GROUP BY cat.id
    ORDER BY total ASC
  `).all(...dateParams, uid);

  // Total spend across ALL transactions (categorized + uncategorized)
  const periodSpend = db.prepare(`
    SELECT COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN connections c ON c.id = a.connection_id
    WHERE c.user_id = ? AND t.amount < 0
      AND (a.is_hidden IS NULL OR a.is_hidden = 0)
      ${dateWhere}
  `).get(...dateParams, uid);

  res.json({
    totalBalance: balances.total_balance,
    accountCount: balances.account_count,
    recentTransactions: periodTxns,
    recentSyncs: lastSync,
    connections,
    categorySpending,
    totalSpend: Math.abs(periodSpend.total),
  });
});

export default router;
