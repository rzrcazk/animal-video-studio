#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PORT="${PORT:-5177}"
PID_FILE="$SCRIPT_DIR/.server.pid"

stop_pid() {
  pid="$1"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "Stopping PID $pid ..."
    kill "$pid" 2>/dev/null || true
    i=0
    while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 20 ]; do
      i=$((i + 1))
      sleep 0.2
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "PID $pid did not exit, forcing stop ..."
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
}

if [ -f "$PID_FILE" ]; then
  stop_pid "$(cat "$PID_FILE")"
  : > "$PID_FILE"
fi

if command -v lsof >/dev/null 2>&1; then
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | while IFS= read -r pid; do
    stop_pid "$pid"
  done
fi

echo "Stopped Animal Video Studio on port $PORT."
