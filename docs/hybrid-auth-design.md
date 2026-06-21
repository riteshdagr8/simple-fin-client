# FinApp Hybrid Auth — Design Document

## Goals

1. **Central user management** — single source of truth for who can use the app
2. **Local data ownership** — each user's bank data, transactions, and settings live only on their device
3. **User-friendly installation** — non-technical users can install on their machine
4. **Strong isolation** — User A can never see User B's data
5. **Standard security** — short-lived access tokens, refresh tokens, password hashing

## Architecture

```
┌──────────────────────────┐         ┌──────────────────────────┐
│  auth-service            │         │  FinApp (per user)       │
│  (central server)        │         │  (laptop/desktop)        │
│                          │         │                          │
│  - User accounts         │         │  - data/{userId}.db      │
│  - Password resets       │         │  - JWT verification     │
│  - Email verification    │         │    (offline-capable)     │
│  - Refresh tokens        │         │  - Local UI              │
│  - RSA-256 key pair      │         │  - Bank sync, etc.       │
│  - JWKS endpoint          │         │                          │
└──────────────────────────┘         └──────────────────────────┘
       HTTPS, REST API
```

## Components

### 1. `auth-service/` — Standalone Express service

**Routes:**
- `POST /api/auth/register` — create account, send verification email
- `POST /api/auth/login` — verify password, issue access + refresh tokens
- `POST /api/auth/refresh` — exchange refresh token for new access token
- `POST /api/auth/logout` — revoke refresh token
- `POST /api/auth/forgot-password` — send reset email
- `POST /api/auth/reset-password` — verify token, change password
- `GET  /api/auth/verify-email?token=X` — verify email
- `GET  /api/auth/me` — get current user (requires JWT)
- `GET  /.well-known/jwks.json` — publish RSA public key (no auth)

**Database (SQLite):**
```sql
users (
  id, email UNIQUE, password_hash, name, email_verified,
  password_changed_at, created_at
)
refresh_tokens (
  id, user_id, token_hash, user_agent, ip, expires_at, revoked_at, created_at
)
email_tokens (
  id, user_id, token, type ('verify'|'reset'), expires_at
)
```

**Security:**
- Same boot-guard as FinApp (refuse default JWT_SECRET)
- Rate limit: 10 login/15min, 5 register/hour, 3 forgot-password/hour
- bcrypt password hashing
- Bcrypt-hashed refresh tokens (DB stores hash, not token)
- JWT: 15-min access, 30-day refresh
- JWT algorithm: RS256 (asymmetric, public key published)
- Helmet, CORS lockdown, request logging

### 2. `server/` (FinApp) — Per-user instance

**Major changes:**
- Remove `users` table from `db.js` — auth-service owns users
- Remove `register`, `forgot-password`, `reset-password`, `verify-email` from `routes/auth.js`
- Keep `login` (proxies to auth-service) and `me` (returns local user profile, if any)
- All other routes use `req.user.userId` from JWT to scope queries

**Per-user DB:**
- `data/{userId}.db` — one file per user
- Created on first authenticated request
- Contains: accounts, transactions, categories, LLM config, rules, settings, categorize_jobs
- The `userId` column on every table is preserved (already exists for multi-user data isolation)
- File path: `path.join(DATA_DIR, `${userId}.db`)`

**JWT verification:**
- On startup, fetch public key from auth-service's `/.well-known/jwks.json`
- Cache public key in memory
- Verify each incoming JWT against cached public key
- No network call per request
- If verification fails: 401

**Login flow:**
1. User opens FinApp → sees login screen
2. User enters email + password → POST to auth-service `/login`
3. Auth-service returns: access_token (JWT, 15min) + refresh_token (30d, opaque)
4. FinApp stores: access_token in localStorage, refresh_token in `data/system.db` (encrypted)
5. Frontend sends `Authorization: Bearer {access_token}` on every request
6. On 401, frontend calls `/api/auth/refresh` → new tokens
7. If refresh fails → clear tokens, show login screen

### 3. `data/system.db` — Per-install state

**Local-only database, not user-scoped:**
- Refresh tokens (encrypted)
- Cached auth-service public key
- Last sync timestamps for offline detection
- App version

### 4. `src-tauri/` — Tauri desktop wrapper

**Why Tauri:**
- Smaller binaries (~10MB vs Electron's 150MB)
- Better security (Rust-based, no Node in the renderer)
- Cross-platform: Windows .exe, Mac .dmg, Linux .AppImage
- Auto-starts Express server when window opens

**Behavior:**
- User double-clicks the app → Tauri opens a window at `tauri://localhost`
- Tauri spawns the Express server as a child process on port 3000
- App's web UI loads from `tauri://localhost`
- Window has its own icon, title, menu (File → Quit, Edit → Find, etc.)
- Closing window kills server cleanly
- First launch: no data, shows login screen
- Subsequent launches: auto-loads refresh token, shows FinApp directly

## Data flow examples

### User logs in
```
FinApp UI → POST {auth-service}/api/auth/login
          → 200 {access_token, refresh_token}
          → Store both locally
          → Redirect to Dashboard
```

### User makes API call
```
FinApp UI → GET /api/transactions
          → authMiddleware: verify JWT with cached public key
          → req.user.userId = "abc123"
          → Query data/abc123.db
          → Return transactions
```

### User's access token expires (15 min)
```
FinApp UI → GET /api/transactions
          → 401 (expired token)
          → Frontend: POST /api/auth/refresh {refresh_token}
          → 200 {new access_token, new refresh_token}
          → Retry original request
```

### User resets password
```
FinApp UI → POST {auth-service}/api/auth/forgot-password
          → Email sent by auth-service
          → User clicks link in email
          → Lands on auth-service reset page (or FinApp if redirect configured)
          → POST {auth-service}/api/auth/reset-password {token, new_password}
          → Password changed, all refresh tokens revoked
          → User must log in again
```

## Files to create

```
auth-service/
  package.json
  server.js
  db.js
  boot-guard.js
  keys.js
  email.js
  routes/
    auth.js
  scripts/
    generate-keys.js
  .env.example

server/                          # FinApp backend
  db.js                          # Refactored: per-user DB loader
  jwt-verify.js                  # NEW: JWKS-based JWT verification
  middleware/
    auth.js                      # Refactored: uses jwt-verify
  routes/
    auth.js                      # Trimmed: only login, me, refresh
    [other routes unchanged]     # Use req.user.userId

src/                              # FinApp frontend
  pages/
    Login.jsx                    # Refactored: calls auth-service
  api.js                          # Refactored: auto-refresh, auth header

data/                              # NEW: per-user DBs
  system.db                      # Created on first run
  {userId}.db                    # Created on first login

src-tauri/                        # NEW: Tauri wrapper
  tauri.conf.json
  src/
    main.rs
    build.rs
  icons/

scripts/
  migrate-to-per-user.mjs         # One-time: convert finapp.db to data/{userId}.db
```

## Migration of existing data

Current state: `finapp.db` has 1 user (Ritesh), 26 accounts, ~626 transactions.

Migration steps:
1. User runs `npm start` after update
2. App detects old `finapp.db`, asks user to enter email
3. App calls `auth-service /api/auth/register` with that email
4. Auth-service creates user, returns userId
5. App renames `finapp.db` to `data/{userId}.db`
6. Updates all `user_id` columns to match the new userId
7. Migration complete

If user already has an account, they can just log in — same flow but no registration.

## Security considerations

- **Private RSA key** is only on the auth-service. If compromised, rotate keys immediately.
- **Public key** is cached in FinApp memory. Rotating it requires users to update.
- **Refresh tokens** stored as bcrypt hashes in DB. DB compromise doesn't leak active tokens.
- **Password reset** invalidates all refresh tokens for that user.
- **Per-user DBs** are isolated by file — User A cannot read User B's DB even with file system access.
- **At-rest encryption** (already implemented) still applies to LLM keys and SimpleFIN access URLs in each user's DB.

## Deployment

### Auth service
- Single Node process
- SQLite database (`auth.db`)
- Reverse proxy with HTTPS (nginx/Caddy) recommended
- Backups of `auth.db` (it's small, just user accounts)
- Email sending via configured SMTP

### FinApp
- Tauri build: `npm run tauri:build` produces installer for current OS
- User downloads .exe / .dmg, double-clicks to install
- No server, no deployment — runs entirely on user's device
- Optionally a "headless" mode: `npm start` runs just the server, user accesses via browser

## Open decisions to revisit later

1. **MFA / 2FA** — not in initial scope, but auth-service schema can be extended
2. **Account recovery** — only via email reset link for now
3. **Audit logs** — auth-service logs all auth events; FinApp could log local events too
4. **Multi-device sync** — each user has multiple devices, but data is per-user, not per-device. Need to decide if data syncs across devices.
   - Current decision: NO sync. Each device is independent. User adds bank connection on each device.
   - Future: could add encrypted cloud backup per user.
