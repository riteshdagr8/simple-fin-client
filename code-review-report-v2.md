EXECUTIVE SUMMARY
- JWT bearer tokens are appended to receipt image URLs and accepted by the API via the query string, so every receipt view leaks a reusable session token to logs, browser history, and any referrer (server/middleware/auth.js:29-45, src/api.js:131-152).
- PDF receipt extraction can never succeed: server/receipt-processor.js misuses pdf-parse (there is no PDFParse class), so every PDF upload throws and the pipeline falls back to “OCR failed”.
- The production server never serves dist assets; only “/” and “/{*rest}” respond with index.html, so /dist/assets/*.js/.css 404 in production (server/index.js:183-190). After build the UI simply cannot load.
- Background syncs have no concurrency guard: cron can trigger syncConnection while a manual sync is still running, hammering SimpleFIN with concurrent calls and duplicating work because syncConnection only rate-limits by 24h count (server/scheduler.js:19-53, server/routes/connections.js:202-322).

CRITICAL ISSUES (must fix before production)
1. JWT tokens exposed via query parameters
   • The auth middleware accepts tokens from req.query.token (server/middleware/auth.js:29-45).  
   • The client builds receipt image/download URLs as /api/receipts/:id/file?token=<JWT> (src/api.js:131-152). Those links end up in DOM attributes, browser history, referer headers, CDN logs, and any copied HTML. Anyone who sees that URL can reuse the JWT with no expiry short of password change. Move the file-serving endpoint behind Authorization headers (e.g., signed cookies or short-lived signed URLs) and drop query-token support entirely.

2. PDF receipts cannot be parsed
   • server/receipt-processor.js:45-53 imports `{ PDFParse } = require('pdf-parse')` and instantiates it. pdf-parse exports a function, not a class, so this throws “PDFParse is not a constructor” on every call. As a result text extraction always fails, the code falls through to “ocr_status = 'failed'”, and the downstream matching never has totals/dates for PDFs. Switch to the documented API (`const pdf = await pdfParse(buffer); const text = pdf.text;`) or replace the dependency.

3. No static assets in production
   • In production mode the server only responds to “/” and “/{*rest}” with index.html (server/index.js:183-190). There is no `express.static` for /dist, so /dist/assets/*.js and *.css 404. After `npm run build && npm start` the SPA cannot load. Mount `express.static(path.join(__dirname, '..', 'dist'))` and rewrite everything else to index.html.

HIGH PRIORITY ISSUES (fix soon)
1. SIGTERM handler crashes
   • server/index.js:204-208 uses `require` inside an ES module. `require` is undefined, so the process throws when SIGTERM arrives; DB handles stay open and cron jobs keep running. Replace with dynamic imports (`const { getDb } = await import('./db.js');`) and stop cron safely.

2. Sync scheduler can overlap syncs
   • `initScheduler` simply iterates every connection every 15 minutes (server/scheduler.js:19-53) and only checks the 24h counter. If a user clicks “Sync” while the cron job is already mid-sync (or two cron ticks collide) you run two `syncConnection` calls concurrently against the same SimpleFIN bridge. There is no “in_progress” flag or advisory lock in sync_log (server/routes/connections.js:202-322). Result: duplicate SimpleFIN requests, inflated rate-limit counters, and simultaneous writes into accounts/transactions. Add a per-connection mutex or mark `sync_log.status='running'` and skip if one exists.

3. Receipt watcher never tracks new users
   • initReceiptWatchers (server/receipt-watch.js:10-19) looks up existing users once at boot and starts chokidar watchers, but there is no code to invoke `startWatchingUser` when a new user registers. Any user created after the last restart will never have their `data/receipts/<id>` folder monitored, so desktop drops are silently ignored until the server restarts. Hook user creation (e.g., after INSERT INTO users) to call startWatchingUser.

4. AI categorization endpoint lacks bounds
   • `/transactions/categorize-llm` trusts `limit` from the body (server/routes/transactions.js:178-265). A malicious client can request millions of rows, causing the server to load the entire transactions table into memory before calling the LLM. Clamp limit to a sane value (e.g., 500) and reject oversized requests.

5. Auto rule application loads everything
   • After every sync the server runs `applyRulesToTransactions` over `SELECT ... WHERE tc.id IS NULL` without LIMIT (server/routes/connections.js:291-317). On a first-time 90‑day sync this pulls every uncategorized transaction in the database, blocking the event loop and re-evaluating rules that already ran. Restrict to “transactions added this sync” or process in batches.

MEDIUM PRIORITY ISSUES
1. `uncategorized` filter ignored – transactions route reads the query param but never adds it to the WHERE clause (server/routes/transactions.js:8-81), so the UI cannot request “uncategorized only”.

2. CSV import dedupe collisions – account import hashes `posted|amount|description` with SHA1 and truncates to 16 hex chars (server/routes/accounts.js:248-265). Different rows with the same day/amount/description collide and are silently dropped. Use the full hash or a UUID.

3. Blocking file deletes – deleting a receipt file uses `fs.unlinkSync` inside the request handler (server/routes/receipts.js:287-289), pausing the event loop while large files are removed.

4. Receipt matching perf – `findMatchingTransactions` instantiates a new Fuse instance for every candidate (server/receipt-processor.js:274-310). Pre-create a single Fuse per receipt or switch to simple string similarity to avoid O(n^2) allocations.

5. Transactions search chatty – every keystroke updates state and immediately reloads the table (src/pages/Transactions.jsx:284-320) with no debounce, generating dozens of API calls per user. Add a 300 ms debounce.

6. Logging leaks email bodies – when RESEND_API_KEY is missing the app logs the entire email body (server/email.js:28-33); verification/reset links include unredacted tokens.

LOW PRIORITY / SUGGESTIONS
- register seeds verification tokens but sets email_verified=1 (server/routes/auth.js:71-95), making verification redundant; either enforce verification before login or drop the token logic.
- `/accounts/:id/transactions` honors arbitrary `limit`, so a user can demand millions of rows (server/routes/accounts.js:172-197). Enforce a cap.
- `receipt-watch` never removes watchers for deleted users, so chokidar instances leak.
- No automated tests or dependency injection around DB/file/LLM layers, making the OCR/LLM pipeline hard to unit test – consider extracting adapters and adding at least regression tests for receipts and transaction categorization.
- `package.json` lacks lint/test scripts; add at least `npm test` so CI can run receipts/transaction logic.

DEPENDENCY NOTES
- `pdf-parse@2.4.5` is being used incorrectly (see critical issue); double-check its API and whether it satisfies your PDF throughput needs.
- `dotenv@17` is still in beta; if you do not need experimental features stick with the latest stable 16.x.
- `tesseract.js@7` spins up a worker per request; consider reusing a worker or switching to a lighter OCR backend if throughput matters.

OVERALL ASSESSMENT
Score: 4/10. The app has a solid feature set but ships with three release-blocking issues (token leakage, broken PDF extraction, missing static assets) plus several architectural gaps around sync concurrency and background watchers. Address the critical items, add locking/limits around heavy jobs, and start introducing automated tests around the receipt pipeline to raise confidence going forward.
