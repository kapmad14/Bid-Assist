#!/usr/bin/env bash
# docker/start.sh
# Robust startup for Render / container runtime
# - Starts node backend
# - Starts parse_supabase_bids.py (background) if present
# - Starts matcher loop (background) if present
# - Starts daily scraper script if gem-scraper exists
# - Tails logs at the end so container stays alive and Render displays logs

set -o pipefail

APP_DIR="/app"
LOG_DIR="${APP_DIR}/logs"
DOCKER_SCRIPTS_DIR="${APP_DIR}/docker"

mkdir -p "${LOG_DIR}"

# helper for logging with timestamp
log() {
  echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') $*"
}

log "=== STARTUP: $(date -u) ==="
cd "${APP_DIR}" || log "WARNING: could not cd to ${APP_DIR}"

# ---------- 1) Start node backend ----------
if [ -f "${APP_DIR}/dist/index.js" ]; then
  log "=== starting node backend ==="
  node dist/index.js >> "${LOG_DIR}/node.log" 2>&1 &
else
  log "WARNING: node dist/index.js not found; skipping node start" >> "${LOG_DIR}/node.log"
fi

sleep 0.2

# ---------- 2) parse_supabase_bids.py (optional) ----------
if [ -f "${APP_DIR}/parse_supabase_bids.py" ]; then
  log "=== starting /app/parse_supabase_bids.py (background) ==="
  # run in background and restart on failure? current script appears to be a loop; keep it simple
  python3 "${APP_DIR}/parse_supabase_bids.py" >> "${LOG_DIR}/parser_loop.log" 2>&1 &
else
  log "NOTICE: /app/parse_supabase_bids.py not found; skipping parser_loop" >> "${LOG_DIR}/parser_loop.log"
fi

sleep 0.2

# ---------- 3) worker_matcher.py loop ----------
# Prefer direct file if present; otherwise fall back to docker helper script if it exists.
if [ -f "${APP_DIR}/worker_matcher.py" ]; then
  log "=== starting worker_matcher.py (loop) ==="
  # run in background as a simple loop wrapper that ensures it restarts after non-zero exit
  (
    while true; do
      log "=== $(date -u) Starting worker_matcher.py ===" >> "${LOG_DIR}/matcher_worker.log"
      python3 "${APP_DIR}/worker_matcher.py" >> "${LOG_DIR}/matcher_worker.log" 2>&1 || true
      log "=== $(date -u) worker_matcher.py exited; sleeping 5s ===" >> "${LOG_DIR}/matcher_worker.log"
      sleep 5
    done
  ) &
elif [ -x "${DOCKER_SCRIPTS_DIR}/run_matcher_loop.sh" ]; then
  log "=== starting ${DOCKER_SCRIPTS_DIR}/run_matcher_loop.sh ==="
  bash "${DOCKER_SCRIPTS_DIR}/run_matcher_loop.sh" >> "${LOG_DIR}/matcher_worker.log" 2>&1 &
else
  log "NOTICE: worker_matcher.py and run_matcher_loop.sh not found; skipping matcher." >> "${LOG_DIR}/matcher_worker.log"
fi

sleep 0.2

# ---------- 4) daily scraper (gem-scraper) ----------
# Your old script attempted `cd /app/gem-scraper` and failed.
# Only launch the docker wrapper if the directory actually exists.
if [ -d "${APP_DIR}/gem-scraper" ]; then
  if [ -x "${DOCKER_SCRIPTS_DIR}/run_daily_gem_scraper.sh" ]; then
    log "=== starting ${DOCKER_SCRIPTS_DIR}/run_daily_gem_scraper.sh ==="
    bash "${DOCKER_SCRIPTS_DIR}/run_daily_gem_scraper.sh" >> "${LOG_DIR}/daily_scraper.log" 2>&1 &
  else
    # try to run a plausible script inside gem-scraper if present (fall-back)
    if [ -x "${APP_DIR}/gem-scraper/run.sh" ]; then
      log "=== starting /app/gem-scraper/run.sh ==="
      bash "${APP_DIR}/gem-scraper/run.sh" >> "${LOG_DIR}/daily_scraper.log" 2>&1 &
    else
      log "NOTICE: docker wrapper run_daily_gem_scraper.sh not executable and no gem-scraper/run.sh found; skipping daily scraper" >> "${LOG_DIR}/daily_scraper.log"
    fi
  fi
else
  log "NOTICE: /app/gem-scraper directory not found; skipping daily scraper" >> "${LOG_DIR}/daily_scraper.log"
fi

sleep 0.2

log "=== background processes started ==="
# show short process list once
ps -eo pid,etime,cmd --sort=pid | sed -n '1,200p'

log "=== tailing logs (${LOG_DIR}/*.log) ==="
# Tail logs so that the container stays alive and Render surfaces logs in the console.
# Use -F so tail follows recreated files.
tail -F "${LOG_DIR}"/*.log
