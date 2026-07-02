#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "Starting SimpleFinClient..."
echo ""

echo "[1/2] Starting Express API server on port 4200..."
PORT=4200 NODE_ENV=development node server/index.js &
EXPRESS_PID=$!
echo "  PID: $EXPRESS_PID"

sleep 2

echo "[2/2] Starting Vite frontend on port 6173..."
npx vite --host &
VITE_PID=$!
echo "  PID: $VITE_PID"

echo ""
echo "Both servers starting."
echo "  API:  http://localhost:4200"
echo "  App:  http://localhost:6173"
echo ""

# Save PIDs for stop.sh
echo "$EXPRESS_PID" > .pids
echo "$VITE_PID" >> .pids

wait
