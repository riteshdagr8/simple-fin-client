import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { initScheduler, initEmailSummaryScheduler, initReceiptCleanupScheduler } from './scheduler.js';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { authMiddleware, optionalAuth } from './middleware/auth.js';
import { getDb } from './db.js';
import connectionsRouter from './routes/connections.js';
import accountsRouter from './routes/accounts.js';
import transactionsRouter from './routes/transactions.js';
import dashboardRouter from './routes/dashboard.js';
import authRouter from './routes/auth.js';
import categoriesRouter from './routes/categories.js';
import settingsRouter from './routes/settings.js';
import rulesRouter from './routes/rules.js';
import receiptsRouter from './routes/receipts.js';
import { ensureSecret, DEFAULT_JWT_SECRET, DEFAULT_ENCRYPTION_KEY } from './boot-guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Security: fail fast on default / missing secrets
ensureSecret('JWT_SECRET', DEFAULT_JWT_SECRET);
ensureSecret('ENCRYPTION_KEY', DEFAULT_ENCRYPTION_KEY, /* allowDefault = */ false);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS — explicit allowlist (default: localhost on common ports)
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Disable X-Powered-By
app.disable('x-powered-by');

// Body size limit
app.use(express.json({ limit: '1mb' }));

// Request logging (skip noisy endpoints)
app.use(morgan('combined', {
  skip: (req) => req.url === '/api/transactions/categorize-jobs/latest',
}));


// Public auth routes (no JWT required)
app.use('/api/auth', authRouter);

// Protected API routes — all require JWT
app.use('/api/connections',    authMiddleware, connectionsRouter);
app.use('/api/accounts',      authMiddleware, accountsRouter);
app.use('/api/transactions',  authMiddleware, transactionsRouter);
app.use('/api/dashboard',     authMiddleware, dashboardRouter);
app.use('/api/categories',    authMiddleware, categoriesRouter);
app.use('/api/settings',      authMiddleware, settingsRouter);
app.use('/api/rules',         authMiddleware, rulesRouter);
app.use('/api/receipts',      authMiddleware, receiptsRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', db: 'connected', uptime: process.uptime() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// Seed data endpoint (dev only — attaches to current user)
if (process.env.NODE_ENV !== 'production') {
  app.post('/api/seed', authMiddleware, async (req, res) => {
    const db = (await import('./db.js')).getDb();

    const now = Date.now();
    const day = 86400000;

  // Remove existing seed connection for a clean slate
  db.prepare("DELETE FROM connections WHERE access_url = 'seed://demo:demo@seed.local/fake'").run();

  // Attach to current user
  const userId = req.user.userId;

  const connResult = db.prepare(
    'INSERT INTO connections (user_id, name, access_url) VALUES (?, ?, ?)'
  ).run(userId, 'Demo Bank (Seed)', 'seed://demo:demo@seed.local/fake');

  const connId = connResult.lastInsertRowid;

  const acctInsert = db.prepare(`
    INSERT OR IGNORE INTO accounts (connection_id, simplefin_id, name, bank_name, currency, balance, balance_date)
    VALUES (?, ?, ?, ?, 'USD', ?, datetime(?, 'unixepoch'))
  `);

  const accounts = [
    { sfid: 'seed-checking', name: 'Primary Checking', bank_name: 'Demo Bank', balance: 4250.00 },
    { sfid: 'seed-savings', name: 'High-Yield Savings', bank_name: 'Demo Bank', balance: 12500.00 },
    { sfid: 'seed-credit', name: 'Rewards Credit Card', bank_name: 'Demo Bank', balance: -1840.50 },
  ];

  const txnInsert = db.prepare(`
    INSERT OR IGNORE INTO transactions (account_id, simplefin_txn_id, posted, amount, description, raw_data)
    VALUES (?, ?, datetime(?, 'unixepoch'), ?, ?, ?)
  `);

  const descriptions = [
    'Grocery Store', 'Restaurant Payment', 'Gas Station', 'Online Purchase', 'Coffee Shop',
    'Pharmacy', 'Hardware Store', 'Book Store', 'Rent Payment', 'Internet Bill',
    'Electric Bill', 'Mobile Phone', 'Streaming Service', 'Gym Membership', 'Insurance',
    'Direct Deposit - Employer', 'Interest Payment', 'ATM Withdrawal', 'Transfer to Savings', 'Doctor Visit',
  ];

  let totalTxns = 0;

  for (const acct of accounts) {
    acctInsert.run(connId, acct.sfid, acct.name, acct.bank_name, acct.balance, Math.floor(now / 1000));

    const acctRow = db.prepare(
      'SELECT id FROM accounts WHERE simplefin_id = ? AND connection_id = ?'
    ).get(acct.sfid, connId);
    if (!acctRow) continue;

    for (let i = 0; i < 20; i++) {
      const posted = Math.floor((now - (i * 2 + 1) * day) / 1000);
      const desc = descriptions[i % descriptions.length];
      const amt = acct.sfid === 'seed-credit'
        ? -(Math.round((10 + Math.random() * 200) * 100) / 100)
        : acct.sfid === 'seed-savings'
          ? (Math.round((0.5 + Math.random() * 5) * 100) / 100)
          : (i % 15 === 0 ? 2750 : -(Math.round((5 + Math.random() * 150) * 100) / 100));
      const result = txnInsert.run(
        acctRow.id, `seed-txn-${acct.sfid}-${i}`, posted, amt, desc,
        JSON.stringify({ posted, amount: amt, description: desc })
      );
      if (result.changes > 0) totalTxns++;
    }
  }

  db.prepare('UPDATE connections SET last_sync_at = datetime(\'now\'), last_error = NULL WHERE id = ?').run(connId);

  res.json({ message: 'Seed data created', connectionId: connId, accounts: accounts.length, transactions: totalTxns });
    }); // end seed endpoint (dev only)
} // end if (NODE_ENV !== production)

if (process.env.NODE_ENV !== 'production') {
  // In development, proxy all non-API requests to the Vite dev server
  app.use('/', createProxyMiddleware({
    target: 'http://localhost:6173',
    changeOrigin: true,
    ws: true,
    logLevel: 'silent',
  }));
} else {
  // Serve built assets (JS/CSS in /assets) before the SPA fallback
  app.use(express.static(path.join(__dirname, '..', 'dist')));
  // SPA fallback — any non-API GET returns index.html so client-side routing works.
  // We use a middleware (not a route) so it doesn't conflict with the static
  // middleware above and works for any URL the client-side router might request.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

// Start server — store reference for graceful shutdown
const server = app.listen(PORT, () => {
  console.log(`FinApp server running on http://localhost:${PORT}`);
  initScheduler();
  initEmailSummaryScheduler();
  initReceiptCleanupScheduler();
  import('./receipt-watch.js').then(({ initReceiptWatchers }) => {
    initReceiptWatchers();
  });
});

// Graceful shutdown — uses dynamic import because this is an ESM module
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

async function shutdown() {
  console.log('[SHUTDOWN] Signal received — shutting down gracefully...');
  try {
    const { getDb } = await import('./db.js');
    try { getDb().pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { console.error('[SHUTDOWN] WAL checkpoint failed:', e.message); }
    try { getDb().close(); } catch {}
  } catch (e) {
    console.error('[SHUTDOWN] DB close failed:', e.message);
  }
  try {
    const cron = await import('node-cron');
    cron.default.getTasks().forEach(t => t.stop());
  } catch (e) {
    console.error('[SHUTDOWN] Cron stop failed:', e.message);
  }
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
  // Force exit if graceful close takes too long
  setTimeout(() => {
    console.warn('[SHUTDOWN] Forced exit after 10s timeout');
    process.exit(1);
  }, 10000).unref();
}
