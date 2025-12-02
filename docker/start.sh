#!/usr/bin/env bash
# docker/start.sh — start node + docker/*.sh loops and tail logs for Render
set -euo pipefail

# run from /app (where Dockerfile sets WORKDIR)
cd /app || true

mkdir -p /app/logs

echo "=== STARTUP: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# 1) Start Node backend (if built)
if [ -f /app/dist/index.js ]; then
  echo "=== starting node backend ==="
  node dist/index.js >> /app/logs/node.log 2>&1 &
else
  echo "=== node dist/index.js not found; skipping node start ==="
fi

# 2) Start run_daily_gem_scraper.sh from docker/ if present
if [ -x /app/docker/run_daily_gem_scraper.sh ]; then
  echo "=== starting /app/docker/run_daily_gem_scraper.sh ==="
  /app/docker/run_daily_gem_scraper.sh >> /app/logs/daily_scraper.log 2>&1 &
elif [ -f /app/docker/run_daily_gem_scraper.sh ]; then
  echo "=== making /app/docker/run_daily_gem_scraper.sh executable and starting ==="
  chmod +x /app/docker/run_daily_gem_scraper.sh
  /app/docker/run_daily_gem_scraper.sh >> /app/logs/daily_scraper.log 2>&1 &
else
  echo "=== /app/docker/run_daily_gem_scraper.sh not found; skipping daily scraper ==="
fi

# 3) Start run_matcher_loop.sh from docker/ if present
if [ -x /app/docker/run_matcher_loop.sh ]; then
  echo "=== starting /app/docker/run_matcher_loop.sh ==="
  /app/docker/run_matcher_loop.sh >> /app/logs/matcher_worker.log 2>&1 &
elif [ -f /app/docker/run_matcher_loop.sh ]; then
  echo "=== making /app/docker/run_matcher_loop.sh executable and starting ==="
  chmod +x /app/docker/run_matcher_loop.sh
  /app/docker/run_matcher_loop.sh >> /app/logs/matcher_worker.log 2>&1 &
else
  echo "=== /app/docker/run_matcher_loop.sh not found; skipping matcher loop ==="
fi

# 4) Start parse_supabase_bids.py (try docker/ then repo root)
if [ -f /app/docker/parse_supabase_bids.py ]; then
  echo "=== starting /app/docker/parse_supabase_bids.py (background) ==="
  python3 /app/docker/parse_supabase_bids.py >> /app/logs/parser_loop.log 2>&1 &
elif [ -f /app/parse_supabase_bids.py ]; then
  echo "=== starting /app/parse_supabase_bids.py (background) ==="
  python3 /app/parse_supabase_bids.py >> /app/logs/parser_loop.log 2>&1 &
else
  echo "=== parse_supabase_bids.py not found in /app/docker or /app; skipping parser ==="
fi

# small pause to let processes initialize
sleep 1

echo "=== background processes started ==="
ps -eo pid,etime,cmd --sort=pid | sed -n '1,200p' || true

# ensure log files exist so tail doesn't immediately exit
touch /app/logs/node.log /app/logs/daily_scraper.log /app/logs/matcher_worker.log /app/logs/parser_loop.log

echo "=== tailing logs (/app/logs/*.log) ==="
# follow logs (blocks)
tail -n +1 -F /app/logs/*.log
