I've now read every source file in the project. Here is the comprehensive review:

---

# COMPREHENSIVE CODE REVIEW — SimpleFinClient / FinApp

## EXECUTIVE SUMMARY

This is a well-structured personal finance application with solid architecture decisions (parameterized queries, AES-256-GCM encryption, per-user data isolation, rate limiting). However, several **critical security issues** and architectural flaws need attention before production use. The three most important findings:

1. **SECURITY: JWT signing key accepts query-string tokens via `req.query.token`** (`server/middleware/auth.js:31`) — JWTs in URLs are logged by proxies, bookmarked, and leaked in `Referer` headers
2. **SECURITY: Registration sets `email_verified=1` by default** (`server/routes/auth.js:72`) — bypassing the entire email verification flow
3. **CRITICAL: Graceful shutdown uses `require()` in an ESM module** (`server/index.js:206-207`) — will crash on SIGTERM

**Overall Score: 6.5/10** — Functional and well-conceived, but needs hardening for production deployment.

---

## CRITICAL ISSUES (Must Fix Before Production)

### [CRIT-1] JWT in URL query parameter — token leakage
**File:** `server/middleware/auth.js:31-32`
```js
const queryToken = req.query.token;
const token = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;
```
**Risk:** JWTs in URLs are leaked via HTTP `Referer` headers, browser history, server access logs, and proxy logs. The frontend also constructs file-access URLs with the token in query strings (`src/api.js:151`: `getReceiptFile: (id) => ${BASE}/receipts/${id}/file?token=${encodeURIComponent(authToken || '')}`).

**Fix:** Remove the query-string token path from the auth middleware. For receipt file serving, use a short-lived signed URL or set the auth cookie on that endpoint instead.

### [CRIT-2] Email verification is completely bypassed
**File:** `server/routes/auth.js:72-73`
```js
'INSERT INTO users (email, password_hash, name, email_verified) VALUES (?, ?, ?, 1)'
```
**Risk:** Every new user is created with `email_verified=1`, meaning unverified users can access all features. The verification email is sent but useless. A malicious user can register with any email and immediately access the app.

**Fix:** Set `email_verified=0` by default. Only set to `1` when the verification link is clicked. Alternatively, remove the whole verification infrastructure if it's truly not intended.

### [CRIT-3] SIGTERM handler uses `require()` in an ESM module
**File:** `server/index.js:204-213`
```js
process.on('SIGTERM', () => {
  const { getDb } = require('./db.js'); // CRASH — ESM module, no require
  try { require('node-cron').stopAll(); } catch {}
```
**Risk:** The graceful shutdown handler will throw `ReferenceError: require is not defined`, which means the process exits uncleanly. On platforms that send SIGTERM (Kubernetes, Docker, systemd), the DB will not be closed gracefully, potentially corrupting the WAL.

**Fix:** Use dynamic `import()` at the top of the handler, or import these at module scope and reference the existing references.

### [CRIT-4] No SQLite WAL checkpoint on shutdown
**File:** `server/db.js:12-16`
```js
db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
```
**Risk:** WAL mode provides performance but the WAL file can grow unbounded. There's no periodic `PRAGMA wal_checkpoint(TRUNCATE)` or shutdown checkpoint. Over time, `finapp.db-wal` grows, and on unclean shutdown the WAL may not be replayed.

**Fix:** Call `db.pragma('wal_checkpoint(TRUNCATE)')` periodically (e.g., after syncs or on a cron) and on graceful shutdown.

---

## HIGH PRIORITY ISSUES (Should Fix Soon)

### [HIGH-1] Multer file filter bypass via crafted MIME type
**File:** `server/routes/receipts.js:37-38`
```js
fileFilter: (req, file, cb) => {
  const allowedTypes = ['image/jpeg', ...];
  if (allowedTypes.includes(file.mimetype)) { cb(null, true); }
```
**Risk:** MIME types come from the client and are trivially spoofed. An attacker can upload `.exe` or `.html` with `Content-Type: image/jpeg`.

**Fix:** Verify file extension AND content magic bytes (e.g., sharp can validate image headers). Reject non-image/non-PDF extensions server-side.

### [HIGH-2] Receipt file serving path traversal
**File:** `server/routes/receipts.js:295-305`
```js
const receipt = db.prepare('SELECT filename, file_type FROM receipts WHERE id = ? AND user_id = ?')
  .get(req.params.id, req.user.userId);
const filePath = path.join(RECEIPTS_DIR, req.user.userId.toString(), receipt.filename);
res.sendFile(filePath);
```
**Risk:** While user ownership IS verified, if an attacker can get a receipt record with a crafted `filename` containing `../`, they could read arbitrary files. This is mitigated by the multer storage which generates UUID-like names, but it's defense-in-depth.

**Fix:** Normalize the resolved path and verify it starts with the expected receipts directory: `if (!resolvedPath.startsWith(RECEIPTS_DIR)) return res.status(403)...`

### [HIGH-3] Recipe processing fires-and-forgets with no error reporting to user
**Files:** `server/routes/receipts.js:133-135`, `server/routes/connections.js:49-51`, `server/routes/transactions.js:257-259`
```js
processReceiptFile(...).catch(err => { console.error(...) });
```
**Risk:** Multiple fire-and-forget async operations fail silently. The `/deep-sync` endpoint immediately returns "Deep sync started" but if the sync fails the user gets no client-side notification (only a server log). Same for receipt processing and LLM categorization.

**Fix:** Return a job tracking ID that the frontend can poll for status, similar to how `categorize_jobs` works in `transactions.js`.

### [HIGH-4] Dashboard query: wrong parameter order for category spending
**File:** `server/routes/dashboard.js:71-84`
```js
const categorySpending = db.prepare(`...WHERE cat.user_id = ? ...`)
  .all(...dateParams, uid);
```
**Bug:** The `dateWhere` placeholder `AND t.amount < 0` is embedded via template literal, but the `dateParams` are spread before `uid`. The query has `WHERE cat.user_id = ?` as the last positional param, with `dateParams` preceding it. If `dateWhere` contains `?` placeholders, they're bound from `dateParams`, and `uid` fills the `cat.user_id = ?`. This actually works correctly because SQLite uses positional binding, but the code is fragile — any change to `dateWhere` that adds/reorders params could silently break the query. Verify this against the `getPeriodWhere` function which returns `{where: "AND t.posted >= datetime('now', '-30 days')", params: []}` — when there are no date params, `uid` correctly fills `cat.user_id = ?`. For custom dates, `dateParams = [start_date, end_date]` and the template has two `?` placeholders from `dateWhere` — so it works, but is very brittle.

### [HIGH-5] LLM API key decrypted for every check response
**File:** `server/routes/settings.js:86`
```js
const api_key = existing.api_key ? decrypt(existing.api_key) : '';
```
**Risk:** If the `/settings/llm/check` handler throws after this line (e.g., network error), an uncaught exception could leak the decrypted key in the error stack trace sent to the client (see `server/routes/settings.js:185`: `res.status(500).json({ error: safeMsg })` — safeMsg is controlled, but ensure no intermediate code leaks the key).

### [HIGH-6] email_verified=1 bypass means password reset tokens for unverified users
**File:** `server/routes/auth.js:147-177`
```js
// Forgot password works for any user regardless of email_verified
```
**Risk:** Since email_verified=1 is hardcoded, this is moot RIGHT NOW, but if email_verification is fixed (CRIT-2), the forgot-password endpoint should verify the user's email is verified before sending a reset token.

---

## MEDIUM PRIORITY ISSUES

### [MED-1] Duplicate keyword rule seeding — 800+ redundant INSERTs
**Files:** `server/routes/auth.js:241-268` and `server/routes/categories.js:112-155`

The same massive keyword bank is defined identically in TWO places. If a rule is added or removed in one, the other becomes stale. This is ~100KB of duplicated data. Additionally, `WALMART` appears in both `Groceries` and `Shopping` lists, and `UNIPRIX` appears twice in the `Healthcare` list (lines `server/routes/auth.js:251`).

**Fix:** Deduplicate into a shared module. Also remove duplicates within the lists — `PROVIGO`, `BC HYDRO`, `HYDRO OTTAWA`, `FIDO`, `KOODO`, `TELUS`, etc. appear multiple times.

### [MED-2] HTML emails: token in URL without HTTPS check
**File:** `server/email.js:63,76`
```js
const url = `${APP_URL}/#/verify-email?token=${token}`;
```
**Risk:** If `APP_URL` is set to `http://` in production, tokens are sent in plaintext. The `.env.example` defaults to `http://localhost:4200`.

**Fix:** Add a boot-time warning/check: `if (NODE_ENV === 'production' && !APP_URL.startsWith('https://')) console.warn(...)`.

### [MED-3] No input sanitization on name field (XSS in email)
**File:** `server/routes/auth.js:73`
```js
name.trim()
```
**Risk:** The name is HTML-escaped in `email.js` via `escapeHtml()`, so XSS via email is prevented. But the raw name is stored and returned in `/auth/me` (`server/routes/auth.js:208`) and the JWT (`server/routes/auth.js:93`). If a frontend component renders `user.name` unsafely, it could be a vector.

**Fix:** Strip HTML tags or validate name as alphanumeric + spaces during registration.

### [MED-4] Scheduler queries ALL connections without user filtering
**File:** `server/scheduler.js:21-26`
```js
const connections = db.prepare(`SELECT c.*, COALESCE(us.sync_interval_hours, 2) as interval_hours
  FROM connections c LEFT JOIN user_settings us ON us.user_id = c.user_id
  WHERE c.user_id IS NOT NULL`).all();
```
**Risk:** This fetches EVERY connection across all users. With 100 users/200 connections, this is 200 rows — each iteration fetches, rate-checks, and syncs. Fine for now, but should be paginated or batched for scalability.

### [MED-5] PDF parsing imports incorrectly — requires CommonJS shim
**File:** `server/receipt-processor.js:3-4`
```js
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');
```
**Risk:** `pdf-parse` is loaded via CommonJS shim but there's no error handling around the `require()`. If `pdf-parse` fails to load (e.g., missing native binding), the entire module crashes. Additionally, `pdf-parse` (version `^2.4.5`) may have compatibility issues with Node versions.

### [MED-6] No CSRF protection
**Risk:** There's no CSRF token anywhere. While the API uses JWT in Authorization headers (immune to simple CSRF), if an XSS vulnerability exists, the attacker can trivially make authenticated requests. For form-based auth (should it ever be added), this would be critical.

**Fix:** For now, document that all auth is via `Authorization: Bearer` header. If cookie-based auth is added later, add CSRF tokens.

### [MED-7] Tesseract.js worker initialized per call — no reuse
**File:** `server/receipt-processor.js:32-39`
```js
const worker = await createWorker('eng', 1, { logger: () => {} });
// ... recognize
await worker.terminate();
```
**Risk:** A new Tesseract worker is created and destroyed for every receipt. Worker creation is expensive (~500ms+ download of language data). Batch processing 10 receipts creates/terminates 10 workers.

**Fix:** Use a worker pool (or at minimum, cache the worker at module scope and recycle it).

### [MED-8] Receipt watcher on `ignoreInitial: false` re-processes existing files
**File:** `server/receipt-watch.js:33`
```js
ignoreInitial: false,
```
**Risk:** On server start, `chokidar` with `ignoreInitial: false` fires `add` events for ALL existing files in the receipts directory. The code checks for existing DB records (`server/receipt-watch.js:53`), so it won't duplicate, but it WILL fire `add` for every file, triggering DB lookups for each. With hundreds of receipts, this is slow on startup.

**Fix:** Set `ignoreInitial: true` and only watch new files. Process existing receipts through a startup sweep instead.

---

## LOW PRIORITY / SUGGESTIONS

### [LOW-1] Unused `done` state in Register page
**File:** `src/pages/Register.jsx:10`
```js
const [done, setDone] = useState(false);
```
This state variable is declared but never used. Dead code.

### [LOW-2] `import` inside function creates dynamic resolve on every call
**File:** `server/routes/connections.js:292`
```js
const { sendMail } = await import('../email.js');
```
This dynamic import is evaluated inside the sync error handler, which is called on every failed sync. Prefer a top-level `import` statement.

### [LOW-3] JWT expiry is 7 days with no refresh mechanism
**File:** `server/middleware/auth.js:9`
```js
const JWT_EXPIRY = '7d';
```
Seven-day tokens with no refresh mechanism mean if a token is stolen, the attacker has a week of access. There's no token revocation (except password change, `isTokenStale`).

**Suggestion:** Use shorter expiry (15-60 min) with a refresh token stored in a `refresh_tokens` table, or add a blacklist for explicit logout.

### [LOW-4] `console.log` server.log contains full error messages that may include secrets
**File:** `server/index.js` uses `morgan('combined')` and various `console.error` calls.
**Risk:** Production logging could leak API keys or access URLs if they appear in error messages (e.g., `LLM API error 401: {"error": "invalid_api_key"}` is fine, but if the key is echoed in error response, it would be logged).

### [LOW-5] `password_changed_at` parse issue — no timezone awareness
**File:** `server/middleware/auth.js:25`
```js
const changedAt = Math.floor(new Date(user.password_changed_at + 'Z').getTime() / 1000);
```
The column stores `datetime('now')` which is SQLite's UTC datetime. Appending `Z` is correct, but SQLite also stores as a string without timezone. This works but is fragile — if the format changes, `new Date()` parsing can fail silently.

### [LOW-6] CSS: hardcoded colors in JSX components
Numerous places in JSX files use hardcoded color values like `#f0fdf4`, `#fef2f2`, `#2563eb`, `#16a34a` instead of CSS variables. This breaks theme switching for those elements.

### [LOW-7] JWT `iat` comparison uses seconds — `password_changed_at` uses SQLite time
**File:** `server/middleware/auth.js:25`
```js
const changedAt = Math.floor(new Date(user.password_changed_at + 'Z').getTime() / 1000);
return tokenIat < changedAt;
```
SQLite `datetime('now')` is stored as text like `2026-06-28 12:00:00`. This conversion to epoch seconds works, but the precision is only to the second. A race exists: if a password is changed and a JWT is issued in the same second, `iat` may equal `changedAt` and the token would not be invalidated (since `iat < changedAt` is false when equal).

### [LOW-8] `/reset-password` — no rate limiting
**File:** `server/routes/auth.js:180`
```js
router.post('/reset-password', async (req, res) => {
```
The reset-password endpoint has no rate limiting, unlike login, register, and forgot-password. An attacker can brute-force reset tokens if they can guess the token format (hex, 64 chars — 256-bit entropy, so computationally infeasible, but defense-in-depth).

### [LOW-9] Receipt file tokens exposed in HTML
**File:** `src/api.js:151`
```js
getReceiptFile: (id) => `${BASE}/receipts/${id}/file?token=${encodeURIComponent(authToken || '')}`,
```
This embeds the JWT directly in HTML `<img src="...">` tags (see `Receipts.jsx:255,293`). Anyone who can view the page source can read the JWT. If the page is rendered server-side or cached, the token persists.

**Fix:** Instead of embedding the JWT in image URLs, serve receipt files through a separate endpoint that uses a short-lived session cookie or a one-time access token.

### [LOW-10] Dashboard categorySpending query: LEFT JOIN repetition
**File:** `server/routes/dashboard.js:71-84`

The `categorySpending` query LEFT JOINs `transactions` and `accounts` within `categories` but only shows categories that the user owns (via `WHERE cat.user_id = ?`). However, the `dateWhere` filter is applied only to `t.posted`, not to the category join itself. This is architecturally correct but could be optimized with a subquery.

### [LOW-11] Express 5 `{*rest}` route syntax
**File:** `server/index.js:187`
```js
app.get('/{*rest}', (req, res) => {
```
In Express 5, the path pattern `/{*rest}` should be `/*` or `/{*rest}` — Express 5 uses a new path-to-regexp syntax. Verify this is correct for Express 5.1.0.

---

## TESTABILITY ASSESSMENT

| Area | Testability | Issues |
|------|-------------|--------|
| **Auth routes** | Medium | Direct DB dependency via `getDb()` singleton; hard to mock |
| **Connection sync** | Low | Tightly coupled: `syncConnection()` calls DB, SimpleFIN API, email, rules — no dependency injection |
| **Receipt processing** | Medium | `tesseract.js` and LLM calls are side-effect heavy; could extract OCR behind an interface |
| **Rules engine** | High | `applyRulesToTransactions()` is a pure function (takes userId + transactions, queries DB internally though) |
| **Dashboard** | Low | Query logic inline in route handler |
| **Frontend pages** | Low | All API calls are inline; no service layer abstraction |

**Recommendation:** Extract DB queries behind repository interfaces. `syncConnection()` is the hardest to test — it combines DB writes, HTTP calls (SimpleFIN API), dynamic imports, and error email sending in ~180 lines.

---

## DEPENDENCY NOTES

| Package | Version | Notes |
|---------|---------|-------|
| `express` | ^5.1.0 | Express 5 is still in beta/RC — may have subtle bugs. Consider ^4.x for stability |
| `multer` | ^2.2.0 | Compatible with Express 5, but verify |
| `pdf-parse` | ^2.4.5 | Check compatibility — may have upstream issues |
| `resend` | ^6.16.0 | Verify SDK compatibility with Node 22+ |
| `tesseract.js` | ^7.0.0 | Worker pool recommended for production |
| `cors` | ^2.8.5 | CORS middleware last updated 2021 — confirm no issues with Express 5 |
| `cross-env` | ^10.1.0 | Dev dependency but in production `dependencies` |

**Missing dep:** No testing framework at all (`vitest`, `jest`, `mocha`) — not even as devDependencies.

---

## FILE-BY-FILE SUMMARY

| File | Issues Found | Severity |
|------|-------------|----------|
| `server/index.js` | CRIT-3, MED-4, LOW-11, CRIT-4 | CRITICAL |
| `server/middleware/auth.js` | CRIT-1, HIGH-6 | CRITICAL |
| `server/routes/auth.js` | CRIT-2, MED-1, MED-3, LOW-8 | CRITICAL |
| `server/routes/receipts.js` | HIGH-1, HIGH-2, HIGH-3, MED-7 | HIGH |
| `server/routes/connections.js` | HIGH-3, LOW-2 | HIGH |
| `server/routes/transactions.js` | HIGH-3 | MEDIUM |
| `server/routes/dashboard.js` | HIGH-4 | HIGH |
| `server/routes/settings.js` | HIGH-5 | HIGH |
| `server/receipt-processor.js` | MED-5, MED-7 | MEDIUM |
| `server/email.js` | MED-2 | MEDIUM |
| `server/db.js` | CRIT-4 | HIGH |
| `server/scheduler.js` | MED-4 | MEDIUM |
| `server/receipt-watch.js` | MED-8 | LOW |
| `server/sync-tracker.js` | None significant | — |
| `server/simplefin.js` | None significant | — |
| `server/crypto.js` | None (sound AES-256-GCM) | — |
| `server/rules.js` | None significant | — |
| `server/llm.js` | None significant | — |
| `server/image-preprocessor.js` | None significant | — |
| `src/api.js` | CRIT-1, LOW-9 | CRITICAL |
| `src/pages/Receipts.jsx` | LOW-9 | MEDIUM |
| `src/pages/Register.jsx` | LOW-1 | LOW |
| All other frontend | MINOR styling inconsistencies (LOW-6) | LOW |

---

## TOP 5 RECOMMENDED ACTIONS (In Order)

1. **Fix CRIT-1**: Remove query-string JWT support from auth middleware and frontend file URLs
2. **Fix CRIT-2**: Either implement real email verification or remove the verification infrastructure entirely
3. **Fix CRIT-3**: Replace `require()` with proper `import()` in the SIGTERM handler
4. **Fix CRIT-4**: Add WAL checkpointing on shutdown and periodically
5. **Fix HIGH-2**: Add path traversal protection for receipt file serving

session_id: 20260628_211904_e6149a
