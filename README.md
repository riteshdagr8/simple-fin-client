# SimpleFinClient

A personal finance manager built with React and Express, powered by [SimpleFIN](https://simplefin.org/) for bank transaction syncing.

## Features

- **Bank Sync** — Connect bank accounts via SimpleFIN for automatic transaction syncing
- **Dashboard** — Overview of balances, recent transactions, and spending by category
- **Transaction Management** — Browse, search, and categorize transactions
- **Auto-Categorization** — AI-powered transaction categorization using OpenAI, Anthropic, or any OpenAI-compatible API
- **Custom Categories** — Create and manage spending categories with custom icons and colors
- **Rules Engine** — Pattern-based rules to auto-categorize transactions
- **Multi-Account** — Support for multiple bank connections and accounts
- **Receipts** — Upload or drop image/PDF receipts into a folder; OCR extracts total, vendor, and date; auto-matches to transactions with optional LLM assistance
- **Email Notifications** — Account verification and password reset via Resend
- **Secure** — JWT auth, bcrypt passwords, encrypted secrets at rest, rate limiting, CSP headers

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite |
| Backend | Express 5, Node.js |
| Database | SQLite (better-sqlite3) |
| Auth | JWT, bcrypt |
| Email | Resend |
| AI | OpenAI-compatible API |
| OCR | Tesseract.js |

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
| `JWT_SECRET` | Long random string for JWT signing |
| `ENCRYPTION_KEY` | 64 hex chars for encrypting stored secrets |
| `RESEND_API_KEY` | Resend API key for sending emails |
| `RESEND_FROM` | Email address for sending emails (e.g., `FinApp <noreply@yourdomain.com>`) |

### Running

```bash
npm run dev
```

- Frontend: http://localhost:6173
- API: http://localhost:4200

### Production

```bash
npm run build
npm start
```

## Project Structure

```
├── server/
│   ├── index.js          # Express entry point
│   ├── db.js             # SQLite database setup
│   ├── auth.js           # JWT middleware
│   ├── crypto.js         # Encryption utilities
│   ├── email.js          # SMTP email sending
│   ├── llm.js            # AI categorization
│   ├── simplefin.js      # SimpleFIN API client
│   ├── rules.js          # Pattern extraction & rules
│   ├── scheduler.js      # Cron-based sync scheduler
│   └── routes/           # API route handlers
├── src/
│   ├── App.jsx           # React router setup
│   ├── api.js            # API client
│   ├── pages/            # Page components
│   └── components/       # Reusable UI components
└── vite.config.js
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Create account |
| POST | `/api/auth/login` | No | Sign in |
| GET | `/api/auth/me` | Yes | Current user |
| GET | `/api/dashboard` | Yes | Dashboard summary |
| GET | `/api/accounts` | Yes | List accounts |
| GET | `/api/transactions` | Yes | List transactions |
| POST | `/api/connections` | Yes | Add bank connection |
| POST | `/api/seed` | Yes | Load demo data |

## License

MIT
