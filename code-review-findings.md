# Code Review — SimpleFinClient

## Overview

Full-stack personal finance dashboard: React/Vite frontend, Express 5 backend, SQLite (better-sqlite3) database. Integrates with SimpleFIN API for bank data, supports receipt OCR/PDF parsing, LLM-based categorization (OpenAI/Anthropic/OpenRouter), email summaries via Resend, and scheduled sync.

## Issues Found & Fixed

### 1. CRITICAL: Live API key exposed in `.env`
**File**: `.env`
**Issue**: `RESEND_API_KEY` contained a live Resend API key (`re_PzrLxF5Z_...`) committed to the copied workspace.
**Fix**: Replaced with placeholder `re_YOUR_API_KEY_HERE`.

### 2. HIGH: TIFF big-endian magic bytes missing
**File**: `server/routes/receipts.js`
**Issue**: Magic byte detection for TIFF only checked little-endian byte order (`49 49 2A 00`). Big-endian TIFFs (`4D 4D 00 2A`) would be rejected as invalid, causing false upload failures.
**Fix**: Added big-endian entries for both `.tif` and `.tiff` extensions.

### 3. HIGH: Port mismatch between Vite and server
**Files**: `vite.config.js`, `.env`
**Issue**: Vite proxy hardcoded `http://localhost:4200` but server defaults to port 3000. Without the `.env` file setting `PORT=4200`, the Vite dev proxy would silently fail.
**Fix**: Changed Vite proxy target to `http://localhost:${process.env.PORT || 4200}` to respect the configured server port.

### 4. HIGH: Unused `nodemailer` dependency
**File**: `package.json`
**Issue**: Both `resend` and `nodemailer` in dependencies, but only `resend` is used in `email.js`.
**Fix**: Removed `nodemailer` from dependencies.

### 5. MEDIUM: DB migration could crash on duplicate rows
**File**: `server/db.js`
**Issue**: Creating `UNIQUE INDEX idx_accounts_unique ON accounts(connection_id, simplefin_id)` would throw if existing data had duplicate `(connection_id, simplefin_id)` pairs from prior syncs, crashing server startup.
**Fix**: Added a dedup step before index creation — deletes duplicate rows keeping the one with the lowest rowid per group.

### 6. MEDIUM: Dynamic imports in receipt cleanup
**File**: `server/scheduler.js`
**Issue**: `runReceiptFileCleanup` used `await import('path')`, `await import('fs')`, and `await import('url')` inside the function body. These are Node built-ins available as static ESM imports.
**Fix**: Moved to top-level static imports.

### 7. LOW: Missing index on `password_changed_at`
**File**: `server/db.js`
**Issue**: The `isTokenStale` check in auth middleware queries `WHERE id = ?` + `password_changed_at` on the `users` table without an index. At scale, every authenticated request scans the users table.
**Fix**: Added `idx_users_password_changed_at` index.

## Issues Noted (Not Actioned)

- **Receipt watcher cleanup on user deletion**: `initReceiptWatchers()` creates chokidar watchers per user at startup. No mechanism stops a watcher when its user is deleted via the API. Requires adding a hook in the user deletion route.
- **CSV import validation**: `POST /:id/transactions/import` enforces `MAX_IMPORT_ROWS` but doesn't validate CSV structure before inserting. A malformed CSV could produce garbage data.
- **JWT expiry (7 days)**: Long-lived tokens for a finance app. Consider reducing to 24h or implementing refresh tokens.

## Files Modified

| File | Change |
|------|--------|
| `.env` | Removed live Resend API key |
| `vite.config.js` | Proxy target reads `PORT` env var |
| `package.json` | Removed unused `nodemailer` |
| `server/db.js` | Dedup before UNIQUE index; added `password_changed_at` index |
| `server/scheduler.js` | Static imports instead of dynamic |
| `server/routes/receipts.js` | Added TIFF big-endian magic bytes |

## Architecture Summary

```mermaid
flowchart TD
    subgraph Frontend [React + Vite]
        A[api.js] -->|fetch| B[/api/*]
        C[Pages] --> A
    end
    subgraph Backend [Express 5]
        B --> D[auth middleware]
        D --> E[Routes]
        E --> F[SQLite]
        E --> G[SimpleFIN API]
        E --> H[LLM API]
        E --> I[Resend Email]
        J[Scheduler] -->|cron| E
        K[Receipt Watcher] -->|chokidar| E
    end
    G -->|OFCX| L[Bank Data]
    H -->|OpenAI/Anthropic| M[AI Categorization]
```
