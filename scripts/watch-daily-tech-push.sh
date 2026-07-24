#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${DAILY_TECH_REPO_DIR:-/Users/farr/Desktop/code/daily-tech-archive}"
REQUEST_FILE="${DAILY_TECH_PUSH_REQUEST_FILE:-$REPO_DIR/daily-tech/.push-request.json}"
PUSH_SCRIPT="${DAILY_TECH_PUSH_SCRIPT:-$REPO_DIR/scripts/push-daily-tech.sh}"
INTERVAL="${DAILY_TECH_WATCH_INTERVAL:-15}"
LOG_DIR="$REPO_DIR/logs"
OUT_LOG="$LOG_DIR/daily-tech-watch-run.out.log"
ERR_LOG="$LOG_DIR/daily-tech-watch-run.err.log"

mkdir -p "$LOG_DIR"

file_mtime() {
  stat -f %m "$REQUEST_FILE" 2>/dev/null || stat -c %Y "$REQUEST_FILE" 2>/dev/null || echo ""
}

last_mtime=""

echo "daily-tech watcher started at $(date '+%F %T')"
echo "watching $REQUEST_FILE"

while true; do
  if [ -f "$REQUEST_FILE" ]; then
    current_mtime="$(file_mtime)"
    if [ -n "$current_mtime" ] && [ "$current_mtime" != "$last_mtime" ]; then
      last_mtime="$current_mtime"
      {
        echo ""
        echo "----- push requested at $(date '+%F %T') -----"
        "$PUSH_SCRIPT"
      } >>"$OUT_LOG" 2>>"$ERR_LOG" || {
        code="$?"
        echo "push failed with exit code $code at $(date '+%F %T')" >>"$ERR_LOG"
      }
    fi
  fi
  sleep "$INTERVAL"
done
