# COMPREHENSIVE CODE REVIEW — SimpleFinClient / FinApp
## Merged Report (GPT 5.1 Codex + DeepSeek analysis)

---

## EXECUTIVE SUMMARY

Well-structured personal finance app with good bones (parameterized SQL, AES-256-GCM, rate limiting), but ships with **three release-blocking bugs** plus several security and architectural gaps.

| # | Finding | Severity |
|---|---------|----------|
| 1 | **JWT in query params** — receipt URLs leak session tokens to logs, referrers, browser history | 🔴 Critical |
| 2 | **PDF receipts can never parse** — `pdf-parse` used as a class constructor, throws on every PDF upload | 🔴 Critical |
| 3 | **No static assets in production** — missing `express.static` for `/dist`, SPA 404s on JS/CSS after build | 🔴 Critical |
| 4 | **Email verification completely bypassed** — `email_verified=1` hardcoded in registration | 🔴 Critical |
| 5 | **SIGTERM handler crashes** — `require()` used in ESM module, throws on shutdown | 🔴 Critical |

**Overall Score: 5/10**

---

## CRITICAL (Must Fix Before Production)

### 1. JWT tokens exposed via query parameters
**Files:** `server/middleware/auth.js:29-45`, `src/api.js:131-152`

The auth middleware accepts tokens from `req.query.token`, and the frontend builds receipt URLs as `/api/receipts/:id/file?token=<JWT>`. These URLs end up in DOM attributes, browser history, `Referer` headers, CDN logs, and any copied HTML. Anyone who sees the URL can reuse the JWT.

**Fix:** Drop `req.query.token` support entirely. Serve receipt files via `Authorization` header, signed cookies, or short-lived one-time tokens.

---

### 2. PDF receipts can never be parsed
**File:** `server/receipt-processor.js:45-53`

```js
const { PDFParse } = require('pdf-parse');
// pdf-parse exports a function, not a class — throws "PDFParse is not a constructor"
```

Every PDF upload hits this error, the catch block sets `ocr_status = 'failed'`, and downstream matching never gets totals/dates for PDFs. The entire PDF receipt pipeline is silently broken.

**Fix:** Use the documented API: `const pdf = await pdfParse(buffer); const text = pdf.text;`

---

### 3. No static assets in production
**File:** `server/index.js:183-190`

In production mode, the server only responds to `"/"` and `"/{*rest}"` with `index.html`. There is no `express.static()` for `/dist`, so `/dist/assets/*.js` and `*.css` return 404. After `npm run build && npm start`, the SPA cannot load.

**Fix:** Mount `express.static(path.join(__dirname, '..', 'dist'))` and rewrite other routes to `index.html`.

---

### 4. Email verification completely bypassed
**File:** `server/routes/auth.js:72-73`

```js
'INSERT INTO users (email, password_hash, name, email_verified) VALUES (?, ?, ?, 1)'
//                                         email_verified always set to 1 ^
```

Every new user gets `email_verified=1`, making the verification email useless. Verification tokens are generated and emailed but never checked. A malicious user can register with any email and immediately access all features. The `/forgot-password` endpoint also works for unverified users (compounding the risk if this is ever fixed).

**Fix:** Set `email_verified=0` by default. Only set to `1` when the verification link is clicked. Or remove the verification infrastructure entirely if it's truly not intended.

---

### 5. SIGTERM handler crashes
**File:** `server/index.js:204-213`

```js
process.on('SIGTERM', () => {
  const { getDb } = require('./db.js'); // CRASH — ESM module, no require
  try { require('node-cron').stopAll(); } catch {}
```

`require` is undefined in ES modules. On SIGTERM (Docker, Kubernetes, systemd), the handler throws, the DB isn't closed gracefully, DB writes may be lost, and WAL corruption is possible.

**Fix:** Use `const { getDb } = await import('./db.js')` and `await import('node-cron')`.

---

### 6. No SQLite WAL checkpoint on shutdown
**File:** `server/db.js:12-16`

WAL mode is enabled (`journal_mode = WAL`) but there's no periodic `PRAGMA wal_checkpoint(TRUNCATE)` or shutdown checkpoint. The WAL file grows unbounded over time, and on unclean shutdown the WAL may not be replayed.

**Fix:** Call `db.pragma('wal_checkpoint(TRUNCATE)')` periodically (after syncs or on a cron) and in the SIGTERM handler.

---

## HIGH PRIORITY (Should Fix Soon)

### H1. Sync scheduler can overlap with manual syncs
**Files:** `server/scheduler.js:19-53`, `server/routes/connections.js:202-322`

`initScheduler` iterates every connection every 15 minutes and only checks the 24-hour rate-limit counter. If a user clicks "Sync" while the cron tick is mid-sync (or two cron ticks collide), `syncConnection` runs concurrently against the same SimpleFIN bridge — duplicate requests, inflated rate-limit counters, simultaneous writes.

**Fix:** Add a per-connection in-progress flag (`sync_log.status='running'`) and skip if one exists. Or use a per-connection mutex.

### H2. Receipt watcher never monitors new users
**File:** `server/receipt-watch.js:10-19`

`initReceiptWatchers` looks up existing users once at boot and starts chokidar watchers. Users created after restart never get their `data/receipts/<id>` folder monitored — desktop drops are silently ignored until server restart.

**Fix:** Call `startWatchingUser(userId)` after `INSERT INTO users` in the registration handler.

### H3. Fire-and-forget async ops with no client error reporting
**Files:** `server/routes/receipts.js:133-135`, `server/routes/connections.js:49-51`, `server/routes/transactions.js:257-259`

```js
processReceiptFile(...).catch(err => { console.error(...) });
```

Multiple fire-and-forget operations (deep sync, receipt processing, LLM categorization) return immediately with "started" but the user never learns if they fail. Only server logs capture errors.

**Fix:** Return a job tracking ID that the frontend can poll for status (similar to `categorize_jobs`).

### H4. Multer file filter trusts client MIME type
**File:** `server/routes/receipts.js:37-38`

```js
if (allowedTypes.includes(file.mimetype)) { cb(null, true); }
```

MIME types come from the client and are trivially spoofed. An attacker can upload `.exe` or `.html` with `Content-Type: image/jpeg`.

**Fix:** Verify file extension AND check content magic bytes (sharp can validate image headers).

### H5. Receipt file serving — path traversal (defense-in-depth)
**File:** `server/routes/receipts.js:295-305`

User ownership is verified via DB query, but if an attacker could create a receipt record with `filename` containing `../`, `path.join` followed by `res.sendFile` could read arbitrary files. Mitigated by UUID filenames from multer.

**Fix:** Normalize the resolved path and verify it starts with the expected receipts directory.

### H6. AI categorization `limit` has no bounds
**File:** `server/routes/transactions.js:178-265`

The `/transactions/categorize-llm` endpoint trusts `limit` from the request body. A malicious client can request millions of rows, causing the server to load the entire transactions table into memory.

**Fix:** Clamp `limit` to a sane value (e.g., 500) and reject oversized requests.

### H7. Auto rule application loads all uncategorized transactions
**File:** `server/routes/connections.js:291-317`

After every sync, `applyRulesToTransactions` runs `SELECT ... WHERE tc.id IS NULL` without LIMIT. On a first-time 90-day sync, this pulls every uncategorized transaction, blocking the event loop and re-evaluating already-applied rules.

**Fix:** Restrict to "transactions added this sync" only, or process in batches.

### H8. Dashboard query parameter ordering is fragile
**File:** `server/routes/dashboard.js:71-84`

```js
const categorySpending = db.prepare(`...WHERE cat.user_id = ? ...`)
  .all(...dateParams, uid);
```

Date params are spread before `uid`. Works by coincidence when `getPeriodWhere` returns empty params, but any change that adds/reorders params silently breaks the query.

**Fix:** Use named bindings or explicitly order parameters.

### H9. LLM API key decrypted on every settings check
**File:** `server/routes/settings.js:86`

The decrypted API key is held in a local variable. If the handler throws after decryption (e.g., network error testing the key), the key could leak in an error stack trace.

**Fix:** Minimize the scope of the decrypted variable, or only decrypt at the exact point of use.

---

## MEDIUM PRIORITY

### M1. Duplicate keyword rule seeding — 800+ redundant INSERTs
**Files:** `server/routes/auth.js:241-268`, `server/routes/categories.js:112-155`

The same massive keyword bank (~100KB) is defined identically in two places. `WALMART` appears in both `Groceries` and `Shopping`. `PROVIGO`, `BC HYDRO`, `FIDO`, etc. appear multiple times within the same list.

**Fix:** Deduplicate into a shared module. Remove intra-list duplicates.

### M2. HTML email tokens sent without HTTPS check
**File:** `server/email.js:63,76`

```js
const url = `${APP_URL}/#/verify-email?token=${token}`;
```

If `APP_URL` is `http://` in production, verification tokens are sent in plaintext. `.env.example` defaults to `http://localhost:4200`.

**Fix:** Add a boot-time warning if `NODE_ENV === 'production'` and `APP_URL` doesn't start with `https://`.

### M3. No input sanitization on name field
**File:** `server/routes/auth.js:73`

The raw name is stored, returned in `/auth/me`, and embedded in the JWT without sanitization. HTML-escaped in emails, but a frontend rendering `user.name` unsafely would be an XSS vector.

**Fix:** Strip HTML tags or validate as alphanumeric + spaces during registration.

### M4. Scheduler queries ALL connections at once
**File:** `server/scheduler.js:21-26`

Fetches every connection across all users without pagination. Fine at small scale, but doesn't scale to hundreds of users.

**Fix:** Paginate or batch, especially for per-connection HTTP calls to SimpleFIN.

### M5. CSV import dedupe collisions
**File:** `server/routes/accounts.js:248-265`

Import hashes `posted|amount|description` with SHA1 and truncates to 16 hex chars. Different rows with the same day/amount/description collide and are silently dropped.

**Fix:** Use the full hash or a UUID-based dedupe key.

### M6. `uncategorized` filter ignored in transactions route
**File:** `server/routes/transactions.js:8-81`

The query param is parsed and stored but never added to the SQL WHERE clause — the UI cannot filter "uncategorized only."

**Fix:** Add the condition to the query builder.

### M7. Receipt matching — Fuse.js re-created per candidate
**File:** `server/receipt-processor.js:274-310`

A new `Fuse` instance is created for every candidate transaction in a loop (O(n) instantiation). Also, exact floating-point amount matching in the candidate SQL (`ABS(t.amount) = ?`) misses transactions with rounding differences.

**Fix:** Create one `Fuse` per receipt call. Use range matching: `ABS(t.amount) BETWEEN ? - 0.01 AND ? + 0.01`.

### M8. Tesseract.js worker initialized per receipt — no reuse
**File:** `server/receipt-processor.js:32-39`

Worker creation is expensive (~500ms+ language data download), but a new worker is created and terminated for every single receipt.

**Fix:** Cache the worker at module scope and recycle it, or use a worker pool.

### M9. Blocking file deletes with `fs.unlinkSync`
**File:** `server/routes/receipts.js:287-289`

Synchronous file deletion inside the request handler pauses the event loop while large files are removed.

**Fix:** Use `fs.promises.unlink()` or queue the deletion.

### M10. Transactions search has no debounce
**File:** `src/pages/Transactions.jsx:284-320`

Every keystroke triggers a full API reload, generating dozens of requests per search.

**Fix:** Add a 300ms debounce on the input handler.

### M11. Logging leaks email bodies and tokens
**File:** `server/email.js:28-33`

When `RESEND_API_KEY` is missing, the app logs the entire email body including verification/reset tokens.

**Fix:** Redact token values in log output, or log only metadata (to/from/subject).

### M12. Receipt watcher — `ignoreInitial: false` re-processes existing files on startup
**File:** `server/receipt-watch.js:33`

On server start, chokidar fires `add` events for ALL existing receipt files. DB checks prevent duplication but it's slow with hundreds of receipts.

**Fix:** Set `ignoreInitial: true` and process existing receipts via a startup sweep.

### M13. No CSRF protection
The API uses JWT in `Authorization` headers (immune to simple CSRF), but the `?token=` query param fallback creates a CSRF-accessible path. No CSRF middleware exists.

**Fix:** Document that all auth is via `Bearer` header. If cookie-based auth is ever added, add CSRF tokens.

### M14. Receipt watcher instances leak for deleted users
No cleanup — when a user is deleted, their chokidar watcher continues running.

**Fix:** Remove watchers in the user deletion handler.

---

## LOW / SUGGESTIONS

| # | Finding | File | Details |
|---|---------|------|---------|
| L1 | Unused `done` state | `src/pages/Register.jsx:10` | `const [done, setDone] = useState(false)` — never read |
| L2 | Dynamic import in sync handler | `server/routes/connections.js:292` | `const { sendMail } = await import('../email.js')` evaluated on every sync error; prefer top-level import |
| L3 | 7-day JWT with no refresh mechanism | `server/middleware/auth.js:9` | Stolen token is usable for a week. Consider 15-60 min expiry + refresh token |
| L4 | `password_changed_at` timezone fragility | `server/middleware/auth.js:25` | Appending `Z` works but is fragile if the SQLite datetime format ever changes |
| L5 | JWT `iat` precision race | `server/middleware/auth.js:25` | If password change and JWT issuance happen in the same second, `iat === changedAt` and the token isn't invalidated |
| L6 | No rate limit on `/reset-password` | `server/routes/auth.js:180` | All other auth endpoints have rate limiting; this one doesn't |
| L7 | Hardcoded CSS colors in JSX | Various pages | `#f0fdf4`, `#2563eb`, etc. break theme switching |
| L8 | Express 5 `{*rest}` route syntax | `server/index.js:187` | Verify `/{*rest}` is correct Express 5.1.0 syntax vs `/*` |
| L9 | Duplicate `llmConfig` query | `server/routes/receipts.js:168-193` | Same SELECT runs twice in the same request |
| L10 | `ocr_status` always 'completed' | `server/receipt-processor.js:416-421` | Status set to 'completed' even when OCR actually failed |
| L11 | `console.log` first 500 chars of LLM response | `server/llm.js:203-204` | Could contain PII from transactions |
| L12 | Fire-and-forget email verification token — token in verify URL | `server/routes/auth.js:122` | POST handler falls back to `req.query.token` even on POST |
| L13 | `dotenv` v17 is still in beta | `package.json` | Consider pinning to stable 16.x unless experimental features are needed |

---

## ARCHITECTURE & TESTABILITY

### What's Good
- **Parameterized SQL everywhere** — no SQL injection vectors
- **AES-256-GCM encryption** for secrets at rest (crypto.js)
- **bcrypt with 12 rounds** for passwords
- **Rate limiting** on login/register/forgot-password
- **Atomic email summary claim** (optimistic lock pattern in email.js)
- **Whitelist-based sort columns** in transactions route
- **Per-user data isolation** in most route queries

### What Needs Work

| Area | Testability | Issues |
|------|-------------|--------|
| Auth routes | Medium | Direct `getDb()` singleton dependency |
| Connection sync | Low | syncConnection() couples DB, SimpleFIN API, email, rules — no DI |
| Receipt processing | Medium | Tesseract.js + LLM + file I/O — hard to mock |
| Rules engine | High | `applyRulesToTransactions()` is closest to testable |
| Dashboard | Low | Query logic inline in route handler |
| Frontend pages | Low | All API calls inline, no service layer |

**Key gaps:**
- **No tests exist anywhere** — no `__tests__` dir, no test scripts in `package.json`, no test dependencies
- **No DI** around DB/file/LLM layers — OCR/LLM pipeline cannot be unit-tested without refactoring
- Receipt watcher relies on real filesystem events — untestable without integration tests

---

## DEPENDENCY NOTES

| Package | Version | Concern |
|---------|---------|---------|
| `express` | ^5.1.0 | Express 5 still in beta/RC — subtle bugs possible |
| `pdf-parse` | ^2.4.5 | Being used incorrectly (Critical #2); verify API compatibility |
| `tesseract.js` | ^7.0.0 | Worker per request is expensive — cache/reuse recommended |
| `cors` | ^2.8.5 | Last updated 2021 — verify Express 5 compatibility |
| `cross-env` | ^10.1.0 | Listed in `dependencies` but should be `devDependencies` |
| `nodemailer` | — | In `package.json` but never imported — dead dependency |
| Testing | ❌ Missing | No `vitest`, `jest`, or `mocha` — not even as devDependencies |

---

## FILE-BY-FILE SUMMARY

| File | Issues Found | Severity |
|------|-------------|----------|
| `server/index.js` | C3, C6, H8, L8 | 🔴 Critical |
| `server/middleware/auth.js` | C1, L3, L4, L5 | 🔴 Critical |
| `server/routes/auth.js` | C4, M1, M3, L6, L12, H1c | 🔴 Critical |
| `server/routes/receipts.js` | C1, H4, H5, H3, M9, L9 | 🔴 Critical |
| `server/receipt-processor.js` | C2, M7, M8, L10 | 🔴 Critical |
| `server/routes/connections.js` | H1, H3, H7, L2 | 🟠 High |
| `server/routes/transactions.js` | H6, H3, M6, M10 | 🟠 High |
| `server/routes/dashboard.js` | H8 | 🟠 High |
| `server/routes/settings.js` | H9 | 🟠 High |
| `server/db.js` | C6 | 🔴 Critical |
| `server/email.js` | M2, M11 | 🟡 Medium |
| `server/receipt-watch.js` | H2, M12, M14 | 🟠 High |
| `server/scheduler.js` | H1 | 🟠 High |
| `server/sync-tracker.js` | None significant | — |
| `server/simplefin.js` | None significant | — |
| `server/crypto.js` | None (sound AES-256-GCM) | — |
| `server/rules.js` | None significant | — |
| `server/llm.js` | L11 | 🟢 Low |
| `server/image-preprocessor.js` | None significant | — |
| `server/boot-guard.js` | — | — |
| `src/api.js` | C1 | 🔴 Critical |
| `src/pages/Receipts.jsx` | C1 (via api.js) | 🔴 Critical |
| `src/pages/Transactions.jsx` | M10 | 🟡 Medium |
| `src/pages/Register.jsx` | L1 | 🟢 Low |
| All other frontend | L7 (hardcoded colors) | 🟢 Low |

---

## TOP 10 RECOMMENDED ACTIONS (In Order)

1. 🔴 **Fix PDF parsing** — `PDFParse is not a constructor` breaks all PDF receipts
2. 🔴 **Serve static assets** — missing `express.static` makes production SPA unusable
3. 🔴 **Remove JWT from query params** — token leak in receipt URLs
4. 🔴 **Fix email verification** — `email_verified=1` makes the whole flow useless
5. 🔴 **Fix SIGTERM handler** — crashes on graceful shutdown
6. 🟠 **Add sync concurrency guard** — prevent overlapping cron + manual syncs
7. 🟠 **Clamp AI categorization limit** — prevent OOM from unbounded limit param
8. 🟠 **Start watching new users' receipts** — post-registration hook missing
9. 🟡 **Deduplicate keyword rules** — same ~100KB data defined in two files
10. 🟡 **Add debounce to transaction search** — dozens of API calls per keystroke
