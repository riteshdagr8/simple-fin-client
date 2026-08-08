#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# On Windows (Git Bash / MSYS / Cygwin) the .cmd scripts are authoritative:
# they launch the dev server with correct Windows PID tracking, which the
# signal-based unix logic can't reproduce against native node.exe children.
if command -v cygpath >/dev/null 2>&1 && [ -f "$ROOT_DIR/start.cmd" ]; then
  # `call` (not a bare full path) so the batch's exit code propagates to us.
  exec cmd //c "call $(cygpath -w "$ROOT_DIR/start.cmd")"
fi

RUN_DIR="$ROOT_DIR/.run"
PID_FILE="$RUN_DIR/dev.pid"
LOG_FILE="$RUN_DIR/dev.log"

mkdir -p "$RUN_DIR"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    printf 'SimpleFinClient is already running (PID %s). Stop it first with ./stop.sh\n' "$PID"
    exit 1
  fi
  rm -f "$PID_FILE"
fi

: > "$LOG_FILE"
printf 'Starting SimpleFinClient development server in the background...\n'

# Launch `npm run dev` as a detached background process. nohup + </dev/null
# detach it from the terminal. We record npm's own PID (not a wrapper shell):
# npm forwards SIGINT/SIGTERM to its children (concurrently → Express + Vite),
# so stop.sh can shut the whole tree down gracefully.
(
  cd "$ROOT_DIR" || exit 1
  PORT=4200 NODE_ENV=development nohup npm run dev >> "$LOG_FILE" 2>&1 </dev/null &
  echo $! > "$PID_FILE"
)

PID=$(cat "$PID_FILE")
if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  printf 'Failed to start SimpleFinClient. See %s.\n' "$LOG_FILE"
  exit 1
fi

# Give the launcher a moment; fail fast if it exits immediately.
sleep 1
if ! kill -0 "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  printf 'SimpleFinClient exited during startup. See %s.\n' "$LOG_FILE"
  exit 1
fi

printf 'Started in the background with PID %s.\n' "$PID"
printf 'Frontend: http://localhost:6173\nAPI:      http://localhost:4200\nLog:      %s\n' "$LOG_FILE"
printf 'Stop it anytime with: ./stop.sh\n'
