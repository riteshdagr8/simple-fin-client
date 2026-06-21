import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
import { ensureSecret, DEFAULT_JWT_SECRET } from './boot-guard.js';
import authRouter from './routes/auth.js';
import { generateRsaKeyPair, loadOrCreateKeys } from './keys.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

// Boot guard
ensureSecret('JWT_SECRET', DEFAULT_JWT_SECRET);

// Generate or load RSA key pair (used for signing access tokens)
const keys = loadOrCreateKeys(path.join(__dirname, 'keys'));
console.log(`[KEYS] RSA key pair loaded. Public key fingerprint: ${crypto.createHash('sha256').update(keys.publicKey).digest('hex').slice(0, 16)}...`);

// Initialize DB
initDb();

// Trust proxy when behind reverse proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.disable('x-powered-by');

// CORS — allow FinApp instances
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5173,app://.,tauri://localhost')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (corsOrigins.includes(origin)) return cb(null, true);
    if (origin.startsWith('tauri://') || origin.startsWith('app://')) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing with limit
app.use(express.json({ limit: '256kb' }));

// Request logging
app.use(morgan('combined'));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', apiLimiter);

// Public JWKS endpoint — FinApp instances fetch this on startup to verify JWTs
app.get('/.well-known/jwks.json', (req, res) => {
  res.json({
    keys: [{
      kty: 'RSA',
      use: 'sig',
      alg: 'RS256',
      kid: 'finapp-1',
      n: keys.publicKeyJwk,
      e: 'AQAB',
    }],
  });
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Auth routes
app.use('/api/auth', authRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[AUTH-SERVICE] Listening on http://localhost:${PORT}`);
  console.log(`[AUTH-SERVICE] JWKS endpoint: http://localhost:${PORT}/.well-known/jwks.json`);
});
