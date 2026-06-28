import jwt from 'jsonwebtoken';
import { getDb } from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'finapp-dev-secret-change-in-production') {
  // This is a second-line check; the primary check is in boot-guard.js
  throw new Error('JWT_SECRET is not set or is the well-known default. See boot-guard.js.');
}
const JWT_EXPIRY = '7d';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Reject tokens issued before the user's last password change
function isTokenStale(userId, tokenIat) {
  if (!tokenIat) return false;
  const db = getDb();
  const user = db.prepare('SELECT password_changed_at FROM users WHERE id = ?').get(userId);
  if (!user || !user.password_changed_at) return false;
  const changedAt = Math.floor(new Date(user.password_changed_at + 'Z').getTime() / 1000);
  return tokenIat < changedAt;
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  const queryToken = req.query.token;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = verifyToken(token);
    if (isTokenStale(payload.userId, payload.iat)) {
      return res.status(401).json({ error: 'Token invalidated by password change. Please sign in again.' });
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const payload = verifyToken(header.slice(7));
      if (!isTokenStale(payload.userId, payload.iat)) {
        req.user = payload;
      }
    } catch {
      // ignore invalid token
    }
  }
  next();
}
