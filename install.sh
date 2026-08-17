#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

echo ""
echo "  ===================================================="
echo "    SimpleFinClient - One-time Install"
echo "  ===================================================="
echo ""

# Make helper scripts executable
chmod +x start.sh stop.sh start.cmd stop.cmd 2>/dev/null || true

# --- Check Node.js ---
if ! command -v node >/dev/null 2>&1; then
  echo "  ERROR: Node.js is not installed."
  echo ""
  echo "  SimpleFinClient needs Node.js 18 or newer to run."
  echo "  Please install it from:  https://nodejs.org"
  echo '  Choose the "LTS" version.'
  echo ""
  echo "  After installing, re-run:  ./install.sh"
  exit 1
fi

echo "  Node.js found: $(node -v)"
echo ""

# --- Create .env from .env.example if missing ---
if [ ! -f ".env" ]; then
  echo "  [1/4] Creating configuration file .env ..."
  if [ ! -f ".env.example" ]; then
    echo "  ERROR: .env.example is missing. Did you download the full project?"
    exit 1
  fi
  cp .env.example .env
  # Auto-generate a random JWT secret (48 bytes hex) and encryption key (32 bytes hex)
  JWT=$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))")
  ENC=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
  # Replace the secret lines (portable sed). APP_URL must be https in
  # production mode; point it at the local app.
  if [ "$(uname)" = "Darwin" ]; then
    sed -i '' "s/^JWT_SECRET=.*/JWT_SECRET=$JWT/" .env
    sed -i '' "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$ENC/" .env
    sed -i '' "s|^APP_URL=.*|APP_URL=https://localhost:4200|" .env
  else
    sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$JWT/" .env
    sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$ENC/" .env
    sed -i "s|^APP_URL=.*|APP_URL=https://localhost:4200|" .env
  fi
  echo "  Configuration created with a random JWT secret and encryption key."
else
  echo "  [1/4] Configuration file .env already exists - keeping it."
fi
echo ""

echo "  [2/4] Installing dependencies (this can take a few minutes)..."
npm install
echo ""

echo "  [3/4] Building the app..."
npm run build
echo ""

echo "  [4/4] Done!"
echo ""
echo "  ===================================================="
echo "    SimpleFinClient is installed!"
echo ""
echo "    To start it, run:  ./start.sh"
echo "    Then open your browser to:  http://localhost:4200"
echo ""
echo "    To stop it later, run:  ./stop.sh"
echo "  ===================================================="
echo ""
echo "  Next steps inside the app:"
echo "    - Create an account (top-right)"
echo "    - Add your SimpleFIN setup token under Connections"
echo ""
