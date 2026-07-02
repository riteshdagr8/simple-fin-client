#!/usr/bin/env bash
cd "$(dirname "$0")"

echo "Stopping SimpleFinClient servers..."

if [ -f .pids ]; then
  while read -r pid; do
    kill "$pid" 2>/dev/null && echo "  Stopped PID $pid" || echo "  PID $pid not found"
  done < .pids
  rm -f .pids
else
  # Fallback: kill node processes by port
  lsof -ti:4200 -ti:6173 2>/dev/null | xargs kill 2>/dev/null
  echo "  Stopped processes on ports 4200 and 6173"
fi

echo "Done."
