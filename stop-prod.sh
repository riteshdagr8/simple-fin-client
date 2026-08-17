#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# On Windows (Git Bash / MSYS / Cygwin) the .cmd scripts are authoritative.
if command -v cygpath >/dev/null 2>&1 && [ -f "$ROOT_DIR/stop-prod.cmd" ]; then
  exec cmd //c "call $(cygpath -w "$ROOT_DIR/stop-prod.cmd")"
fi

PID_FILE="$ROOT_DIR/.run/prod.pid"

if [ ! -f "$PID_FILE" ]; then
  printf 'SimpleFinClient is not running in production.\n'
  exit 0
fi

PID=$(cat "$PID_FILE")
rm -f "$PID_FILE"

if ! kill -0 "$PID" 2>/dev/null; then
  printf 'Removed stale PID file.\n'
  exit 0
fi

printf 'Stopping SimpleFinClient (PID %s)...\n' "$PID"

descendants() {
  parent=$1
  for child in $(pgrep -P "$parent" 2>/dev/null || true); do
    descendants "$child"
    printf '%s\n' "$child"
  done
}

signal_tree() {
  sig=$1
  for p in $(descendants "$PID"); do
    kill -s "$sig" "$p" 2>/dev/null || true
  done
  kill -s "$sig" "$PID" 2>/dev/null || true
}

tree_alive() {
  kill -0 "$PID" 2>/dev/null && return 0
  for p in $(descendants "$PID"); do
    kill -0 "$p" 2>/dev/null && return 0
  done
  return 1
}

signal_tree INT
n=0
while tree_alive && [ "$n" -lt 12 ]; do
  sleep 0.5
  n=$((n + 1))
done

if tree_alive; then
  printf 'Graceful shutdown timed out; terminating process tree.\n'
  signal_tree TERM
  sleep 1
fi

if tree_alive; then
  printf 'Process still running; forcing termination.\n'
  signal_tree KILL
fi

printf 'SimpleFinClient stopped.\n'
