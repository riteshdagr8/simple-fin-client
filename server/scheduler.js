import cron from 'node-cron';
import { syncConnection } from './routes/connections.js';
import { getDb } from './db.js';
import { canSyncConnection, MAX_SYNCS_PER_DAY } from './sync-tracker.js';
import { sendSummaryEmail } from './email.js';

const MIN_INTERVAL_HOURS = 1; // 1 hour minimum between scheduled syncs
const DEFAULT_INTERVAL_HOURS = 2;

let scheduledTask = null;

export function initScheduler() {
  // Run every 15 minutes to check each user's preferred interval
  // (lightweight: only does work if at least one connection is due)
  if (scheduledTask) {
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule('*/15 * * * *', async () => {
    const db = getDb();
    const connections = db.prepare(`
      SELECT c.*, COALESCE(us.sync_interval_hours, 2) as interval_hours
      FROM connections c
      LEFT JOIN user_settings us ON us.user_id = c.user_id
      WHERE c.user_id IS NOT NULL
    `).all();

    for (const conn of connections) {
      try {
        // Skip if rate limit reached
        const check = canSyncConnection(conn.id);
        if (!check.allowed) {
          continue;
        }

        // Skip if not yet time for next scheduled sync
        const intervalHours = Math.max(MIN_INTERVAL_HOURS, conn.interval_hours || DEFAULT_INTERVAL_HOURS);
        if (conn.last_sync_at) {
          const lastSync = new Date(conn.last_sync_at);
          const dueAt = new Date(lastSync.getTime() + intervalHours * 60 * 60 * 1000);
          if (Date.now() < dueAt.getTime()) {
            continue;
          }
        }

        await syncConnection(conn.id, conn.user_id, 'scheduled');
        // 2-second delay between syncs
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (err) {
        console.error(`Scheduled sync failed for connection ${conn.id}:`, err.message);
      }
    }
  });

  console.log(`Scheduler initialized: checks every 15 min, per-user intervals (default ${DEFAULT_INTERVAL_HOURS}h, min ${MIN_INTERVAL_HOURS}h, max ${MAX_SYNCS_PER_DAY}/day)`);
}

// --- Email summary scheduler ---

const HIDDEN_FILTER = '(a.is_hidden IS NULL OR a.is_hidden = 0)';

export async function buildSummaryData(userId, settings) {
  const db = getDb();
  const data = {};

  if (settings.include_total_balance || settings.include_per_account_balance) {
    if (settings.include_total_balance) {
      const row = db.prepare(`
        SELECT COALESCE(SUM(a.balance), 0) as total_balance,
               COUNT(DISTINCT a.id) as account_count
        FROM accounts a
        JOIN connections c ON c.id = a.connection_id
        WHERE c.user_id = ? AND ${HIDDEN_FILTER}
      `).get(userId);
      data.balances = { totalBalance: row.total_balance || 0, accountCount: row.account_count || 0 };
    }
    if (settings.include_per_account_balance) {
      data.accounts = db.prepare(`
        SELECT a.name, a.bank_name, a.balance, a.currency, c.name as connection_name
        FROM accounts a
        JOIN connections c ON c.id = a.connection_id
        WHERE c.user_id = ? AND ${HIDDEN_FILTER}
        ORDER BY c.name, a.name
      `).all(userId);
    }
  }

  if (settings.include_per_category_spending) {
    data.categorySpending = db.prepare(`
      SELECT cat.id, cat.name, cat.icon, cat.color,
             COALESCE(SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END), 0) as total
      FROM categories cat
      LEFT JOIN transaction_categories tc ON tc.category_id = cat.id
      LEFT JOIN transactions t ON t.id = tc.transaction_id
      LEFT JOIN accounts a ON a.id = t.account_id AND ${HIDDEN_FILTER}
      LEFT JOIN connections c ON c.id = a.connection_id AND c.user_id = cat.user_id
      WHERE cat.user_id = ?
      GROUP BY cat.id
      ORDER BY total ASC
    `).all(userId);
  }

  if (settings.include_todays_transactions) {
    data.todaysTransactions = db.prepare(`
      SELECT t.posted, t.amount, t.description, a.name as account_name
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      JOIN connections c ON c.id = a.connection_id
      WHERE c.user_id = ? AND ${HIDDEN_FILTER}
        AND t.posted >= datetime('now', 'start of day')
      ORDER BY t.posted DESC
      LIMIT 100
    `).all(userId);
  }

  if (settings.include_weeks_transactions) {
    data.weeksTransactions = db.prepare(`
      SELECT t.posted, t.amount, t.description, a.name as account_name
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      JOIN connections c ON c.id = a.connection_id
      WHERE c.user_id = ? AND ${HIDDEN_FILTER}
        AND t.posted >= datetime('now', 'weekday 0', '-6 days')
      ORDER BY t.posted DESC
      LIMIT 100
    `).all(userId);
  }

  return data;
}

let emailSummaryRunning = false;
let emailSummaryTask = null;

export async function runDueSummaries() {
  if (emailSummaryRunning) {
    console.warn('[EMAIL-SUMMARY] Previous run still in progress, skipping tick.');
    return;
  }
  emailSummaryRunning = true;
  try {
    const db = getDb();
    const dueUsers = db.prepare(`
      SELECT es.user_id, es.frequency_hours
      FROM email_summary_settings es
      JOIN users u ON u.id = es.user_id
      WHERE es.enabled = 1
        AND u.email IS NOT NULL AND u.email != ''
        AND (es.last_sent_at IS NULL
             OR datetime(es.last_sent_at, '+' || es.frequency_hours || ' hours') <= datetime('now'))
    `).all();

    if (dueUsers.length === 0) return;

    console.log(`[EMAIL-SUMMARY] ${dueUsers.length} user(s) due for summary.`);

    for (const row of dueUsers) {
      try {
        const result = await sendSummaryEmail(row.user_id);
        if (result.sent) {
          db.prepare(`
            UPDATE email_summary_settings
            SET last_sent_at = datetime('now'),
                next_send_at = datetime('now', '+' || ? || ' hours'),
                updated_at = datetime('now')
            WHERE user_id = ?
          `).run(row.frequency_hours, row.user_id);
          console.log(`[EMAIL-SUMMARY] Sent to user ${row.user_id} (${result.email}).`);
        } else {
          console.log(`[EMAIL-SUMMARY] Skipped user ${row.user_id}: ${result.skipped}.`);
        }
      } catch (err) {
        console.error(`[EMAIL-SUMMARY] Failed for user ${row.user_id}:`, err.message);
      }
    }
  } finally {
    emailSummaryRunning = false;
  }
}

export function initEmailSummaryScheduler() {
  if (emailSummaryTask) {
    emailSummaryTask.stop();
  }
  emailSummaryTask = cron.schedule('*/5 * * * *', () => {
    runDueSummaries().catch(err => {
      console.error('[EMAIL-SUMMARY] Tick failed:', err.message);
    });
  });
  console.log('Email summary scheduler initialized: checks every 5 min.');
}
