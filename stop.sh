#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

# On Windows (Git Bash / MSYS / Cygwin) the .cmd scripts are authoritative —
# they track the real Windows PID, which the signal-based logic below can't
# reach against native node.exe children. Delegate to stop.cmd.
if command -v cygpath >/dev/null 2>&1 && [ -f "$ROOT_DIR/stop.cmd" ]; then
  # `call` (not a bare full path) so the batch's exit code propagates to us.
  exec cmd //c "call $(cygpath -w "$ROOT_DIR/stop.cmd")"
fi

PID_FILE="$ROOT_DIR/.run/dev.pid"

if [ ! -f "$PID_FILE" ]; then
  printf 'SimpleFinClient is not running.\n'
  exit 0
fi

PID=$(cat "$PID_FILE")
rm -f "$PID_FILE"

if ! kill -0 "$PID" 2>/dev/null; then
  printf 'Removed stale PID file.\n'
  exit 0
fi

printf 'Stopping SimpleFinClient (PID %s)...\n' "$PID"

# Recursively list descendants of $1 (via pgrep -P), deepest children first.
# pgrep -P is present on macOS and Linux.
descendants() {
  parent=$1
  for child in $(pgrep -P "$parent" 2>/dev/null || true); do
    descendants "$child"
    printf '%s\n' "$child"
  done
}

# Send a signal to the whole tree, deepest children first.
signal_tree() {
  sig=$1
  for p in $(descendants "$PID"); do
    kill -s "$sig" "$p" 2>/dev/null || true
  done
  kill -s "$sig" "$PID" 2>/dev/null || true
}

# Is the tree still alive? (npm, or any descendant when pgrep is available)
tree_alive() {
  kill -0 "$PID" 2>/dev/null && return 0
  for p in $(descendants "$PID"); do
    kill -0 "$p" 2>/dev/null && return 0
  done
  return 1
}

# SIGINT lets Express checkpoint SQLite (WAL) and shut down; npm forwards it to
# the concurrently tree. The app's own forced-exit timer is 10s, so cap the
# wait below that — the WAL checkpoint happens immediately and any lingering
# process is swept by the escalation below instead of stalling this script.
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
