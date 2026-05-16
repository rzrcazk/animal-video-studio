#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PORT="${PORT:-5177}"
FOLLOW_LOGS="${FOLLOW_LOGS:-1}"
PID_FILE="$SCRIPT_DIR/.server.pid"
LOG_DIR="$SCRIPT_DIR/logs"
LOG_FILE="$LOG_DIR/server.log"

"$SCRIPT_DIR/stop.sh"

mkdir -p "$LOG_DIR"
cd "$SCRIPT_DIR"

echo "Starting Animal Video Studio on http://localhost:$PORT ..."
PORT="$PORT" nohup npm start >> "$LOG_FILE" 2>&1 &
PID="$!"
echo "$PID" > "$PID_FILE"

sleep 1
if kill -0 "$PID" 2>/dev/null; then
  echo "Started. PID: $PID"
  echo "Log: $LOG_FILE"
  if [ "$FOLLOW_LOGS" != "0" ]; then
    echo "Showing live logs. Press Ctrl+C to stop watching logs; the server keeps running."
    tail -n 80 -f "$LOG_FILE"
  fi
else
  echo "Start failed. Check log: $LOG_FILE" >&2
  tail -n 80 "$LOG_FILE" >&2
  exit 1
fi
