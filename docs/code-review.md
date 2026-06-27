# SimpleFinClient — Full Code Review

## Overview

A personal finance manager built with React 19 + Express 5, integrating SimpleFIN Bridge for bank transaction syncing, with AI-powered categorization and email summaries.

**Tech Stack:** React 19, Vite, Express 5, SQLite (better-sqlite3), JWT, AES-256-GCM, node-cron, Nodemailer

---

## Architecture Summary

```
Browser (React SPA)
  ├── Hash Router (no server config needed)
  ├── API Client (fetch wrapper, auto-attach JWT)
  └── 11 pages, 5 reusable components

Express Server
  ├── 8 route groups (auth, connections, accounts, transactions,
  │   dashboard, categories, settings, rules)
  ├── JWT auth middleware (with token invalidation on password change)
  ├── AES-256-GCM encryption for secrets at rest
  ├── SQLite database (13 tables, WAL mode)
  ├── SimpleFIN Bridge client
  ├── LLM client (OpenAI-compatible + Anthropic)
  ├── Rules engine (keyword + history-based)
  ├── Cron scheduler (auto-sync every 15min, email every 5min)
  └── Nodemailer SMTP transport
```

---

## Critical Issues

### 1. Hardcoded Secrets in Start Scripts
**Files:** `start-express.ps1`, `start-vite.ps1`

The PowerShell start scripts contain JWT_SECRET, ENCRYPTION_KEY, and SMTP credentials in plaintext. While gitignored, they're visible in the workspace and could be accidentally committed.

**Fix:** Remove hardcoded secrets from scripts. Load from `.env` only.

### 2. Client/Server Password Validation Mismatch
**Files:** `src/pages/Register.jsx`, `src/pages/ResetPassword.jsx`, `server/routes/auth.js`

- Client (Register.jsx): `minLength={8}`, placeholder says "At least 8 characters"
- Client (ResetPassword.jsx): `password.length < 8`
- Server (auth.js): requires 10+ chars, at least one letter AND one number

Users pass client validation but get rejected by the server with no clear guidance.

**Fix:** Align client validation to match server: `minLength={10}`, add letter+number pattern hint.

### 3. No CSRF Protection — JWT in localStorage
**Files:** `src/api.js`, `server/middleware/auth.js`

JWT tokens stored in localStorage are vulnerable to XSS attacks. If an attacker can inject script, they can steal the token.

**Fix:** Consider HttpOnly cookies with SameSite=Strict, or add CSRF token validation.

---

## Warnings

### 4. Email Verification Effectively Disabled
**File:** `server/routes/auth.js:72`

Users are created with `email_verified=1` at registration. The verification email is sent but never checked. The `VerifyEmail.jsx` page exists but the user is already fully authenticated.

**Impact:** Low — acceptable for MVP, but should be enabled in production.

### 5. Dead Code in rules.js
**File:** `server/rules.js` — `buildPatternsForCategory()`

First query references `t.user_id` which doesn't exist on the transactions table. The variable `txns` is never used. Would throw if reached.

**Fix:** Remove the dead query.

### 6. No Token Cleanup
**Files:** `server/db.js` (email_tokens, reset_tokens tables)

Expired tokens accumulate forever. No periodic cleanup or startup pruning.

**Fix:** Add cleanup on startup or periodic job: `DELETE FROM email_tokens WHERE expires_at < datetime('now')`.

### 7. /api/seed Available in Production
**File:** `server/index.js:86-156`

The seed endpoint creates demo data. Auth-protected but available in production.

**Fix:** Wrap in `if (process.env.NODE_ENV !== 'production')`.

### 8. Single SQLite for All Users
**Files:** `server/db.js`

All users share one database. A compromised file exposes all users' financial data.

**Impact:** Acceptable for personal/small-group use. The design doc (`docs/hybrid-auth-design.md`) describes a per-user DB architecture but it's not implemented.

---

## Improvements

### 9. No Test Suite
Zero test files. Critical paths to test:
- `crypto.js`: encrypt/decrypt roundtrip
- `rules.js`: pattern extraction, rule matching
- `llm.js`: response parsing (line-by-line and JSON fallback)
- Route integration tests (auth, transactions, connections)

### 10. No Health Check Endpoint
Add `GET /api/health` returning `{ status: 'ok', db: 'connected' }`.

### 11. No Graceful Shutdown
No SIGTERM handler. Important for production:
```js
process.on('SIGTERM', () => {
  db.close();
  cron.stop();
  server.close();
});
```

### 12. .env.example Incomplete
Missing `ENCRYPTION_KEY` (required by boot guard). New users get startup errors.

### 13. Incomplete auth-service
`auth-service/` references `./db.js`, `./keys.js` which don't exist. Either complete or remove.

### 14. WebSocket for LLM Progress
Polling every 2s works but is wasteful. Consider SSE or WebSocket.

---

## What's Done Well

### Security
- AES-256-GCM encryption for API keys and SimpleFIN access URLs
- Boot guard refuses to start with default/missing secrets
- Rate limiting on auth endpoints (10 logins/15min, 5 registrations/hr)
- CSP headers via Helmet
- Explicit CORS allowlist
- Token invalidation on password change (password_changed_at check)

### Architecture
- Clean separation: routes / services / middleware
- Singleton DB with WAL mode for concurrent reads
- Fire-and-forget sync (non-blocking UI)
- Job tracking for background LLM work with frontend polling
- 3-tier categorization: rules (free, instant) → manual → LLM (paid, async)
- Dedupe indexes prevent duplicate accounts and transactions

### Developer Experience
- Concurrent dev server (Express + Vite via concurrently)
- Seed data endpoint for testing
- SQL migration pattern (ALTER TABLE on startup)
- Clean React component architecture
- Two themes via CSS custom properties

### Feature Completeness
- Full auth flow (register, login, forgot/reset password, email verify)
- SimpleFIN integration with rate limiting (24/day per connection)
- AI categorization with OpenAI, Anthropic, and custom providers
- Rules engine with keyword and history-based patterns
- Email summaries with configurable content and frequency
- CSV import for manual transactions
- Multi-theme support (minimal/colorful)
- Bulk operations (assign categories, rename accounts)
- Paginated, sortable, filterable transaction table

---

## File-by-File Notes

| File | Lines | Notes |
|------|-------|-------|
| `server/index.js` | 171 | Clean entry point. Seed endpoint should be prod-gated. |
| `server/db.js` | 226 | Good migration pattern. Add token cleanup. |
| `server/crypto.js` | ~60 | Solid AES-256-GCM implementation. |
| `server/email.js` | ~150 | Good HTML escaping. Lazy transport init. |
| `server/llm.js` | 180 | Handles reasoning models well. Good error messages. |
| `server/simplefin.js` | 81 | Clean API client. Demo vs real token handling. |
| `server/rules.js` | 156 | Dead code in buildPatternsForCategory(). Otherwise solid. |
| `server/scheduler.js` | 191 | Atomic claim pattern for email summaries. |
| `server/sync-tracker.js` | ~40 | Simple rate limiter. Matches SimpleFIN's 24/day. |
| `server/middleware/auth.js` | ~80 | Good token invalidation on password change. |
| `server/routes/auth.js` | 230 | Password validation mismatch with client. |
| `server/routes/connections.js` | ~250 | Core sync logic. Well-structured. |
| `server/routes/transactions.js` | ~300 | Complex filtering. Good SQL injection prevention. |
| `server/routes/settings.js` | ~200 | Model check endpoint is clever. |
| `src/App.jsx` | ~120 | Hash routing. Auth context. Theme management. |
| `src/api.js` | ~100 | Clean fetch wrapper. Auto-attach token. |
| `src/pages/Transactions.jsx` | ~400 | Most complex page. Filters, bulk, LLM. |
| `src/pages/Settings.jsx` | ~250 | Multi-section. Good UX. |

---

## Recommendations Priority

1. **Fix password validation mismatch** — immediate user-facing bug
2. **Remove dead code in rules.js** — prevents runtime errors
3. **Add token cleanup** — prevents DB bloat
4. **Gate /api/seed in production** — security hygiene
5. **Add tests** — especially for crypto and rules
6. **Add health check** — operational necessity
7. **Complete or remove auth-service** — reduce confusion
