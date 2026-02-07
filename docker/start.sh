#!/usr/bin/env bash
set -euo pipefail

cd /app || exit 1

echo "=== Container startup $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# Ensure logs directory exists
mkdir -p ./logs

# ---- Start matcher loop in background ----
echo "Starting matcher loop..."
/app/docker/run_matcher_loop.sh &

MATCHER_PID=$!

# ---- Start Node server in foreground ----
echo "Starting Node server..."
node dist/index.js

# If node exits, also stop matcher loop
echo "Node process exited — stopping matcher loop"
kill "$MATCHER_PID" || true
wait "$MATCHER_PID" || true
