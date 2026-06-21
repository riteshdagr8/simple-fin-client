import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { getDb } from '../db.js';
import { signToken, authMiddleware } from '../middleware/auth.js';
import { generateToken, sendVerificationEmail, sendResetEmail } from '../email.js';

const router = Router();

const PUBLIC_PATHS = new Set([
  '/register', '/login', '/verify', '/forgot-password', '/reset-password',
]);

// Per-endpoint rate limits
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many accounts created from this IP. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Too many password reset requests. Try again in 1 hour.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Mount under /api/auth — middleware applied at parent level in index.js
router.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
  authMiddleware(req, res, next);
});

// Register
router.post('/register', registerLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are required' });
  }
  // Strengthened policy: 10+ chars, at least one letter and one number
  if (password.length < 10) {
    return res.status(400).json({ error: 'Password must be at least 10 characters' });
  }
  if (!/[A-Za-z]/.test(password)) {
    return res.status(400).json({ error: 'Password must contain at least one letter' });
  }
  if (!/[0-9]/.test(password)) {
    return res.status(400).json({ error: 'Password must contain at least one number' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const token = generateToken();

  const userResult = db.prepare(
    'INSERT INTO users (email, password_hash, name, email_verified) VALUES (?, ?, ?, 1)'
  ).run(email.toLowerCase(), passwordHash, name.trim());

  const userId = userResult.lastInsertRowid;

  // Store verification token
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    'INSERT INTO email_tokens (user_id, token, expires_at) VALUES (?, ?, ?)'
  ).run(userId, token, expiresAt);

  // Seed default categories for this user
  seedDefaultCategories(db, userId);

  // Send verification email (non-blocking)
  sendVerificationEmail(email, name, token).catch(err => {
    console.error('Failed to send verification email:', err.message);
  });

  // Auto-login: create JWT immediately (email_verified=1 for MVP)
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const jwt = signToken({ userId: user.id, email: user.email });
  res.status(201).json({ token: jwt, user: { id: user.id, name: user.name, email: user.email } });
});

// Login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken({ userId: user.id, email: user.email });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

// Shared handler for GET (email link) and POST (frontend) verification
function handleVerify(req, res) {
  // Accept token from query string OR body
  const token = (req.method === 'GET' ? req.query.token : req.body?.token) || req.query.token;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  const db = getDb();
  const record = db.prepare(
    `SELECT et.*, u.name FROM email_tokens et JOIN users u ON u.id = et.user_id
     WHERE et.token = ? AND et.expires_at > datetime('now')`
  ).get(token);

  if (!record) {
    return res.status(400).json({ error: 'Invalid or expired verification token' });
  }

  db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(record.user_id);
  db.prepare('DELETE FROM email_tokens WHERE id = ?').run(record.id);
  res.json({ message: 'Email verified successfully', name: record.name });
}

// GET: used by email link → returns JSON for the React app to consume
router.get('/verify', handleVerify);

// POST: same handler, but token is in body (not in URL/server logs)
router.post('/verify', handleVerify);

// Forgot password
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email is required' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) {
    // Don't reveal whether email exists
    console.log(`[FORGOT] No user found for: ${email}`);
    return res.json({ message: 'If an account exists, a reset email has been sent' });
  }

  console.log(`[FORGOT] User found: ${user.email} (${user.name}). Sending reset email...`);

  // Invalidate old tokens
  db.prepare('DELETE FROM reset_tokens WHERE user_id = ?').run(user.id);

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)')
    .run(user.id, token, expiresAt);

  try {
    await sendResetEmail(user.email, user.name, token);
    console.log(`[FORGOT] Email sent to ${user.email}`);
    res.json({ message: 'Reset email sent. Check your inbox.' });
  } catch (err) {
    console.error('[FORGOT] Email send failed:', err.message);
    res.status(500).json({ error: 'Failed to send email. Check your SMTP settings.', detail: err.message });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'token and password are required' });
  if (password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' });
  if (!/[A-Za-z]/.test(password)) return res.status(400).json({ error: 'Password must contain at least one letter' });
  if (!/[0-9]/.test(password)) return res.status(400).json({ error: 'Password must contain at least one number' });

  const db = getDb();
  const record = db.prepare(
    `SELECT rt.* FROM reset_tokens rt WHERE rt.token = ? AND rt.expires_at > datetime('now')`
  ).get(token);

  if (!record) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  // Update password AND timestamp — invalidates any existing JWTs (iat < password_changed_at)
  db.prepare(`UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?`)
    .run(passwordHash, record.user_id);
  db.prepare('DELETE FROM reset_tokens WHERE id = ?').run(record.id);

  res.json({ message: 'Password reset successfully' });
});

// Get current user
router.get('/me', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email, name, email_verified, created_at FROM users WHERE id = ?')
    .get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

function seedDefaultCategories(db, userId) {
  const defaults = [
    { name: 'Groceries', icon: '🛒', color: '#22c55e' },
    { name: 'Dining', icon: '🍽️', color: '#f59e0b' },
    { name: 'Transport', icon: '🚗', color: '#3b82f6' },
    { name: 'Gas/Auto', icon: '⛽', color: '#0ea5e9' },
    { name: 'Shopping', icon: '🛍️', color: '#ec4899' },
    { name: 'Entertainment', icon: '🎬', color: '#8b5cf6' },
    { name: 'Travel', icon: '✈️', color: '#06b6d4' },
    { name: 'Education', icon: '📚', color: '#a855f7' },
    { name: 'Utilities', icon: '💡', color: '#64748b' },
    { name: 'Tax/Fee', icon: '🧾', color: '#dc2626' },
    { name: 'Healthcare', icon: '🏥', color: '#ef4444' },
    { name: 'Income', icon: '💰', color: '#16a34a' },
    { name: 'Transfer', icon: '🔄', color: '#6b7280' },
    { name: 'Other', icon: '📁', color: '#9ca3af' },
  ];

  const insert = db.prepare(
    'INSERT OR IGNORE INTO categories (user_id, name, icon, color, is_default) VALUES (?, ?, ?, ?, 1)'
  );
  for (const cat of defaults) {
    insert.run(userId, cat.name, cat.icon, cat.color);
  }
}

export default router;
