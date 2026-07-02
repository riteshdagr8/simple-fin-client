# SimpleFinClient

A personal finance manager built with React and Express, powered by [SimpleFIN](https://simplefin.org/) for bank transaction syncing.

## Features

### Bank Sync
- Connect bank accounts via SimpleFIN Bridge for automatic transaction syncing
- Deep Sync — fetch up to 90 days of historical transactions
- Reauthentication flow when SimpleFIN requires re-login
- Connection reset — delete all data and resync from scratch
- Rolling 24-hour sync limit (max 24 syncs/day per SimpleFIN's limit)

### Dashboard
- Overview of balances, recent transactions, and spending by category
- Per-account and per-category breakdowns

### Transaction Management
- Browse, search, and sort transactions
- Filter by account, bank, category, date range
- Bulk category assignment

### Auto-Categorization
- AI-powered categorization using OpenAI, Anthropic, DeepSeek, or any OpenAI-compatible API
- Keyword-based rules seeded with common Canadian merchants
- History-based pattern extraction for custom categories
- One-click "Auto-Categorize" with progress tracking

### Receipt Processing
- Upload images (JPEG, PNG) or PDFs via the UI or drop folder
- OCR with Tesseract.js — extracts total, vendor, and date
- Image preprocessing with sharp — grayscale, normalize, sharpen, trim whitespace
- PDF text extraction with pdf-parse; scanned PDFs auto-detected and OCR'd
- LLM-based extraction — sends receipt image (vision models) or OCR text to the LLM for structured extraction
- Auto-detects non-vision providers (DeepSeek, etc.) and falls back to text extraction
- Smart matching — algorithmic scoring (amount + date + vendor) with optional LLM-assisted disambiguation
- Manual match — search all transactions and pick one
- Re-match and re-extract buttons for retrying failed extractions
- Receipt file cleanup — auto-delete matched receipts after 3 months; manual delete per receipt

### Appearance
- 8 color themes to choose from: Emerald Prestige, Midnight Indigo, Charcoal & Ember, Noir & Gold, Cloud White, Ocean Deep, plus legacy Minimal and Colorful
- Themes apply instantly with CSS custom properties — light and dark options available
- Theme selection persists across sessions (stored server-side and in localStorage)

### Local Backup
- Download all your data as a readable Excel file (.xlsx) with separate sheets for Accounts, Categories, and Transactions
- One-click download from the Settings page

### Settings
- LLM configuration — provider, API key, model, base URL
- Vision model override — manually enable/disable image input for any model
- Sync interval — configurable per-user (1-24 hours)
- Email summaries — daily/weekly balance and transaction reports
- 8 color themes — instant CSS custom property swap
- One-click Excel backup of all financial data

### Security
- JWT authentication with bcrypt passwords (Authorization header only — no token-in-URL)
- Encrypted secrets at rest (AES-256-GCM)
- Rate limiting on auth endpoints (login, register, forgot-password, reset-password)
- CSP headers via Helmet
- Receipt files served via blob URL with Authorization header
- Email verification required for new accounts (`email_verified=0` by default)
- Magic-byte content validation on uploaded receipts (rejects spoofed mimetypes)
- Per-connection sync lock prevents cron + manual sync races
- WAL checkpoint on shutdown for crash safety

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite |
| Backend | Express 5, Node.js |
| Database | SQLite (better-sqlite3, WAL mode) |
| Auth | JWT, bcrypt |
| Email | Resend |
| AI | OpenAI-compatible API (OpenAI, Anthropic, DeepSeek, Qwen, Ollama, etc.) |
| OCR | Tesseract.js |
| Image Processing | sharp |
| PDF Parsing | pdf-parse |

## Getting Started

### Prerequisites

- Node.js 18+
- A [SimpleFIN](https://simplefin.org/) setup token (for bank sync)

### Installation

```bash
git clone https://github.com/riteshdagr8/simple-fin-client.git
cd simple-fin-client
npm install
```

### Configuration

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required environment variables:

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Long random string for JWT signing (64+ hex chars) |
| `ENCRYPTION_KEY` | 64 hex chars for encrypting stored secrets |
| `RESEND_API_KEY` | Resend API key for sending emails |
| `RESEND_FROM` | Email sender address (e.g., `FinApp <noreply@yourdomain.com>`) |
| `APP_URL` | Your app URL for email links (e.g., `http://localhost:4200`) |

### Running

```bash
npm run dev
```

- Frontend: http://localhost:6173 (proxied through Express in development)
- API: http://localhost:4200

### Production

```bash
npm run build
npm start
```

### Docker

```bash
docker compose up -d
```

Requires Docker Desktop. Mounts `.env` for secrets and `./data/` for persistent database and receipts.

- App: http://localhost:4200

## Project Structure

```
├── server/
│   ├── index.js              # Express entry point
│   ├── db.js                 # SQLite database setup + migrations
│   ├── crypto.js             # AES-256-GCM encryption utilities
│   ├── email.js              # Resend email integration
│   ├── llm.js                # LLM client (OpenAI, Anthropic, vision support)
│   ├── simplefin.js          # SimpleFIN Bridge API client
│   ├── rules.js              # Pattern extraction & keyword rules
│   ├── receipt-processor.js  # OCR + LLM receipt extraction + matching
│   ├── image-preprocessor.js # Image trimming/resizing with sharp
│   ├── default-keywords.js   # Shared merchant→category keyword list
│   ├── receipt-watch.js      # File system watcher for drop folder
│   ├── sync-tracker.js       # Sync rate limiting
│   ├── scheduler.js          # Cron-based sync + cleanup schedulers
│   └── routes/
│       ├── auth.js           # Register, login, forgot/reset password
│       ├── connections.js    # Bank connections, sync, deep sync, reset
│       ├── transactions.js   # Transaction listing + categorization
│       ├── accounts.js       # Account management
│       ├── categories.js     # Category CRUD + seed
│       ├── rules.js          # Categorization rules
│       ├── receipts.js       # Receipt upload, match, delete, file serving
│       ├── settings.js       # LLM, sync, email summary settings
│       └── backup.js          # Excel backup download
├── src/
│   ├── App.jsx               # React router setup
│   ├── api.js                # API client
│   ├── pages/
│   │   ├── Dashboard.jsx     # Dashboard view
│   │   ├── Transactions.jsx  # Transaction list + categorization
│   │   ├── Connections.jsx   # Bank connections + sync controls
│   │   ├── Receipts.jsx      # Receipt management
│   │   ├── Settings.jsx      # App settings
│   │   ├── Login.jsx         # Login/register
│   │   └── Categories.jsx    # Category management
│   └── components/
│       └── ConfirmDialog.jsx # Reusable confirmation modal
└── vite.config.js
```

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

### Receipts
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/receipts` | Yes | List all receipts |
| GET | `/api/receipts/:id` | Yes | Receipt detail + candidates |
| POST | `/api/receipts/upload` | Yes | Upload receipt (multipart) |
| POST | `/api/receipts/:id/rematch` | Yes | Re-run matching (add `?reextract=1` for LLM re-extraction) |
| POST | `/api/receipts/:id/match` | Yes | Manual match to transaction |
| DELETE | `/api/receipts/:id/file` | Yes | Delete file only (keep record) |
| DELETE | `/api/receipts/:id` | Yes | Delete receipt + file |
| GET | `/api/receipts/:id/file` | Yes | Serve receipt file |

### Settings
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/settings/llm` | Yes | Get LLM configuration |
| PUT | `/api/settings/llm` | Yes | Save LLM configuration |
| POST | `/api/settings/llm/check` | Yes | Test LLM connection |
| GET | `/api/settings/sync` | Yes | Get sync settings + current theme |
| PUT | `/api/settings/sync` | Yes | Save sync interval and theme |
| GET | `/api/settings/email-summary` | Yes | Get email summary config |
| PUT | `/api/settings/email-summary` | Yes | Save email summary config |

### Backup
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/backup/download` | Yes | Download Excel backup (Accounts, Categories, Transactions sheets) |

## Receipt Processing Pipeline

1. **Upload** — Image/PDF saved to `data/receipts/{userId}/`
2. **OCR** — Tesseract.js extracts text (images) or pdf-parse (text-based PDFs)
3. **Preprocessing** — sharp trims whitespace, normalizes contrast, resizes for LLM
4. **LLM Extraction** — If enabled, vision model extracts structured data; non-vision models use OCR text
5. **Matching** — Algorithmic scoring (amount + date + vendor) with LLM disambiguation for ambiguous cases
6. **Cleanup** — Files auto-deleted 3 months after matching

## License

MIT
