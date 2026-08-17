# SimpleFinClient

A self-hosted personal finance manager. Connect your bank accounts via [SimpleFIN](https://simplefin.org/), sync transactions automatically, categorize spending (with or without AI), match receipts, and reconcile transfers between your own accounts — all on your own machine, no cloud service required.

![React](https://img.shields.io/badge/React-19-61dafb) ![Express](https://img.shields.io/badge/Express-5-green) ![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-blue)

---

## Quick start (no technical knowledge needed)

If you just want to run the app on your own computer, you don't need to know how to build software or use GitHub.

1. **Get the code** — on this GitHub page, click the green **Code** button, then **Download ZIP**. Unzip it to a folder on your computer (e.g. your Desktop).
2. **Install Node.js** — if you don't already have it, download and install the "LTS" version from <https://nodejs.org>. This is required once, and only once.
3. **Run the installer** — open the unzipped folder and double-click:
   - **Windows:** `install.cmd`
   - **macOS / Linux:** open a terminal in that folder and run `./install.sh`
   The installer checks Node, installs dependencies, creates your configuration (with secure random keys), and builds the app. It takes a few minutes the first time.
4. **Start the app** — double-click `start.cmd` (Windows) or run `./start.sh` (macOS/Linux).
5. **Open your browser** to <http://localhost:4200> and create an account.
6. **Connect your bank** — go to **Connections** and paste a [SimpleFIN setup token](https://beta-bridge.simplefin.org/). SimpleFinClient will fetch your accounts and transactions.

That's it. Your data stays on your computer.

### Stopping the app

- Double-click `stop.cmd` (Windows) or run `./stop.sh` (macOS/Linux).

---

## Optional: Docker

If you already use Docker, you can run the whole app in a container instead:

```bash
cp .env.example .env   # then fill in JWT_SECRET and ENCRYPTION_KEY
docker compose up -d
```

Open <http://localhost:4200>. Stop with `docker compose down`. Data and your `.env` are persisted via volumes.

---

## For developers

### Prerequisites

- Node.js 18+
- A [SimpleFIN](https://simplefin.org/) setup token (for bank sync)

### Install & run

```bash
git clone https://github.com/riteshdagr8/simple-fin-client.git
cd simple-fin-client
npm install
cp .env.example .env
```

Fill in the required values in `.env` (see [Configuration](#configuration)). Then run the development server:

```bash
npm run dev
```

- Frontend (dev): <http://localhost:6173>
- API: <http://localhost:4200>

### Production build

```bash
npm run build
npm start
```

Serves the built frontend and API on `PORT` (default 4200).

### Start/stop scripts

Cross-platform scripts are included and work from any folder:

| Platform | Start (dev) | Stop (dev) | Start (prod) | Stop (prod) |
|----------|-------------|------------|--------------|-------------|
| Windows | `start.cmd` | `stop.cmd` | `start-prod.cmd` | `stop-prod.cmd` |
| macOS / Linux | `./start.sh` | `./stop.sh` | `./start-prod.sh` | `./stop-prod.sh` |

The dev scripts run `npm run dev` (Express + Vite) in the background and save runtime state/logs under `.run/`. The prod scripts run the built app (`npm start`). On Windows (including Git Bash) the `.cmd` scripts are authoritative and the `.sh` scripts delegate to them.

---

## Features

### Bank Sync
- Connect bank accounts via SimpleFIN Bridge for automatic transaction syncing
- Deep Sync — fetch up to 90 days of historical transactions
- Reauthentication flow when SimpleFIN requires re-login
- Connection reset — delete all data and resync from scratch
- Rolling 24-hour sync limit (max 24 syncs/day per SimpleFIN's limit)
- Scheduled syncs with a configurable per-user interval (1–24 hours)

### Transfer Reconciliation
- Automatically detect transfers between your own accounts (e-transfer, bill pay, etc.)
- Auto-pair high-confidence matches; review and approve the rest
- Reconciled transfers **cancel out** and are excluded from spending totals
- Hidden accounts (e.g. joint accounts synced twice, secondary cards) are never suggested as transfers
- Manual match any two transactions; unpair with one click
- New **Transfers** page (`#/transfers`)

### Dashboard
- Overview of balances, recent transactions, and spending by category
- Per-account and per-category breakdowns
- Reconciled transfers excluded from "spent in period"

### Transaction Management
- Browse, search, and sort transactions
- Filter by account, bank, category, and a quick Current/Last-month date range
- Bulk category assignment
- CSV import per account

### Auto-Categorization
- AI-powered categorization using OpenAI, Anthropic, DeepSeek, or any OpenAI-compatible API
- Keyword-based rules seeded with common Canadian merchants
- History-based pattern extraction for custom categories
- One-click "Auto-Categorize" with progress tracking

### Receipt Processing
- Upload images (JPEG, PNG) or PDFs via the UI or a drop folder
- OCR with Tesseract.js — extracts total, vendor, and date
- Image preprocessing with sharp
- PDF text extraction; scanned PDFs auto-detected and OCR'd
- LLM-based extraction (vision and non-vision providers)
- Smart matching with optional LLM-assisted disambiguation; manual match too
- Receipt file cleanup — auto-delete matched receipts after 3 months

### Backup & Export
- **Daily automated database backups** to `backups/` (keeps the last 14)
- **Export to Excel** — download accounts, categories, and transactions as a `.xlsx` file from Settings

### Themes
- Six color palettes (Cloud White, Emerald Prestige, Midnight Indigo, Charcoal & Ember, Noir & Gold, Ocean Deep)
- Pick yours in Settings; saved per account, applies instantly

### Settings
- LLM configuration — provider, API key, model, base URL
- Sync interval — configurable per-user
- Email summaries — balance and transaction reports
- Backup / Excel export

### Security
- JWT authentication with bcrypt passwords (Authorization header only)
- Encrypted secrets at rest (AES-256-GCM)
- Rate limiting on auth endpoints
- CSP headers via Helmet
- Receipt files served via blob URL with Authorization header
- Magic-byte content validation on uploads
- Per-connection sync lock prevents cron + manual sync races
- WAL checkpoint on shutdown for crash safety
- **DB safety guard** — tests and scratch scripts are refused if pointed at the production database

---

## Configuration

Copy `.env.example` to `.env` and fill in your values. `install.cmd` / `install.sh` do this for you automatically with secure random secrets.

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | Long random string for JWT signing (64+ hex chars) |
| `ENCRYPTION_KEY` | Yes | 64 hex chars for encrypting stored secrets |
| `RESEND_API_KEY` | No | Resend API key for emails (verification, summaries). Without it, emails are logged instead of sent |
| `RESEND_FROM` | No | Email sender address (e.g., `FinApp <noreply@yourdomain.com>`) |
| `APP_URL` | No | Public URL for email links (default `http://localhost:4200`) |
| `PORT` | No | Server port (default 4200) |
| `CORS_ORIGIN` | No | Comma-separated allowed origins |

Generate strong secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # ENCRYPTION_KEY
```

---

## Project Structure

```
├── server/
│   ├── index.js              # Express entry point (bootstrap: secrets, listen, shutdown)
│   ├── app.js                # Express app construction (imported by tests too)
│   ├── db.js                 # SQLite setup + migrations (incl. transfer_pairs)
│   ├── db-guard.js           # Refuses scratch/test ops against the production DB
│   ├── backup.js             # Daily DB snapshots + retention pruning
│   ├── transfers.js          # Transfer matching / scoring service
│   ├── crypto.js             # AES-256-GCM encryption utilities
│   ├── email.js              # Resend email integration
│   ├── llm.js                # LLM client (OpenAI, Anthropic, vision support)
│   ├── simplefin.js          # SimpleFIN Bridge API client
│   ├── rules.js              # Pattern extraction & keyword rules
│   ├── receipt-processor.js  # OCR + LLM receipt extraction + matching
│   ├── scheduler.js          # Cron-based sync, email, receipt cleanup, backups
│   └── routes/
│       ├── auth.js           # Register, login, forgot/reset password
│       ├── connections.js    # Bank connections, sync, deep sync, reset
│       ├── transactions.js   # Transaction listing + categorization
│       ├── accounts.js       # Account management + CSV import
│       ├── categories.js     # Category CRUD + seed
│       ├── rules.js          # Categorization rules
│       ├── receipts.js       # Receipt upload, match, delete, file serving
│       ├── settings.js       # LLM, sync, email summary settings
│       ├── transfers.js      # Transfer reconciliation endpoints
│       └── backup.js         # Excel export
├── src/
│   ├── App.jsx               # React router setup
│   ├── api.js                # API client
│   ├── theme.js              # 6-palette theme definitions
│   └── pages/ + components/  # React views and shared components
├── install.cmd / install.sh  # One-click setup for non-developers
├── start.cmd / stop.cmd      # Windows dev start/stop
├── start.sh / stop.sh        # macOS/Linux dev start/stop
├── start-prod.* / stop-prod.*# Production start/stop
├── Dockerfile / docker-compose.yml  # Optional Docker deployment
└── test/                     # Node built-in test suites
```

---

## Testing

```bash
npm test
```

Runs the Node built-in test runner against an ephemeral SQLite database and HTTP server. Suites cover authentication, cross-user data isolation, transfer reconciliation, and the receipt image pipeline.

```bash
npm run lint
```

Runs ESLint across the codebase.

---

## API Endpoints

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Create account |
| POST | `/api/auth/login` | No | Sign in |
| POST | `/api/auth/forgot-password` | No | Request password reset email |
| POST | `/api/auth/reset-password` | No | Reset password with token |
| POST | `/api/auth/verify` | No | Verify email address |
| GET | `/api/auth/me` | Yes | Current user profile |

### Connections & Sync
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/connections` | Yes | List bank connections |
| POST | `/api/connections` | Yes | Add bank connection |
| POST | `/api/connections/:id/sync` | Yes | Manual sync (1 day lookback) |
| POST | `/api/connections/:id/deep-sync` | Yes | Deep sync (90 day lookback) |
| PUT | `/api/connections/:id/reauthenticate` | Yes | Reauthenticate with new setup token |
| DELETE | `/api/connections/:id` | Yes | Delete connection + all accounts/transactions |

### Transactions
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/transactions` | Yes | List with filters (search, date, account, category) |
| POST | `/api/transactions/:id/categorize` | Yes | Assign category |
| POST | `/api/transactions/bulk-categorize` | Yes | Bulk assign categories |
| POST | `/api/transactions/categorize-llm` | Yes | Start LLM categorization job |
| GET | `/api/transactions/categorize-jobs/latest` | Yes | Check job status |

### Transfers
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/transfers` | Yes | List reconciled pairs |
| GET | `/api/transfers/candidates` | Yes | Reviewable transfer candidates |
| POST | `/api/transfers/scan` | Yes | Auto-pair strong-signal transfers |
| POST | `/api/transfers/pairs` | Yes | Manually pair two transactions |
| DELETE | `/api/transfers/pairs/:id` | Yes | Unpair |

### Receipts
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/receipts` | Yes | List all receipts |
| GET | `/api/receipts/:id` | Yes | Receipt detail + candidates |
| POST | `/api/receipts/upload` | Yes | Upload receipt (multipart) |
| POST | `/api/receipts/:id/rematch` | Yes | Re-run matching (`?reextract=1` for LLM re-extraction) |
| POST | `/api/receipts/:id/match` | Yes | Manual match to transaction |
| DELETE | `/api/receipts/:id/file` | Yes | Delete file only (keep record) |
| DELETE | `/api/receipts/:id` | Yes | Delete receipt + file |
| GET | `/api/receipts/:id/file` | Yes | Serve receipt file |

### Backup
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/backup/download` | Yes | Download all data as Excel (.xlsx) |

### Settings
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/settings/llm` | Yes | Get LLM configuration |
| PUT | `/api/settings/llm` | Yes | Save LLM configuration |
| POST | `/api/settings/llm/check` | Yes | Test LLM connection |
| GET/PUT | `/api/settings/sync` | Yes | Sync interval + theme |
| GET/PUT | `/api/settings/email-summary` | Yes | Email summary preferences |

---

## Troubleshooting

- **`node` is not recognized / command not found** — install Node.js LTS from <https://nodejs.org>, then re-run the installer.
- **Port 4200 is already in use** — another instance may be running. Run the stop script, or change `PORT` in `.env`.
- **Bank sync fails with "Auth required"** — your SimpleFIN bridge needs reauthentication; go to Connections and re-add with a fresh setup token.
- **Emails aren't arriving** — either add a valid `RESEND_API_KEY`, or check the server log where emails are printed instead of sent.
- **Where is my data stored?** — in `finapp.db` at the project root. Daily backups are in `backups/`.

---

## Architecture note

The current codebase is a **single-instance, shared-SQLite** application that issues local HMAC JWTs. `docs/hybrid-auth-design.md` describes a future central-auth-service + per-user-database architecture; it is **not implemented**. See the banner at the top of that document.

---

## License

MIT
