#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# On Windows (Git Bash / MSYS / Cygwin) the .cmd scripts are authoritative.
if command -v cygpath >/dev/null 2>&1 && [ -f "$ROOT_DIR/start-prod.cmd" ]; then
  exec cmd //c "call $(cygpath -w "$ROOT_DIR/start-prod.cmd")"
fi

RUN_DIR="$ROOT_DIR/.run"
PID_FILE="$RUN_DIR/prod.pid"
LOG_FILE="$RUN_DIR/prod.log"

mkdir -p "$RUN_DIR"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    printf 'SimpleFinClient is already running in production (PID %s). Stop it first with ./stop-prod.sh\n' "$PID"
    exit 1
  fi
  rm -f "$PID_FILE"
fi

: > "$LOG_FILE"
printf 'Starting SimpleFinClient in production mode in the background...\n'

(
  cd "$ROOT_DIR" || exit 1
  NODE_ENV=production nohup npm start >> "$LOG_FILE" 2>&1 </dev/null &
  echo $! > "$PID_FILE"
)

PID=$(cat "$PID_FILE")
if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  printf 'Failed to start SimpleFinClient. See %s.\n' "$LOG_FILE"
  exit 1
fi

sleep 1
if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  printf 'SimpleFinClient exited during startup. See %s.\n' "$LOG_FILE"
  exit 1
fi

printf 'Started in production with PID %s.\n' "$PID"
printf 'App:  http://localhost:4200\nLog:  %s\n' "$LOG_FILE"
printf 'Stop it anytime with: ./stop-prod.sh\n'
