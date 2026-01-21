#!/usr/bin/env bash
# docker/start.sh
# Robust startup for Render / container runtime
# - Starts node backend
# - Starts update_tenders_from_pdfs_fixed_v4.py (background) if present
# - Starts matcher loop (background)
# - Starts daily scraper (if gem-scraper exists)
# - Starts daily backfill at 07:00 IST
# - Tails logs so container stays alive

set -o pipefail

APP_DIR="/app"
LOG_DIR="${APP_DIR}/logs"
DOCKER_SCRIPTS_DIR="${APP_DIR}/docker"

mkdir -p "${LOG_DIR}"

log() {
  echo "$(date -u +'%Y-%m-%dT%H:%M:%SZ') $*"
}

log "=== STARTUP: $(date -u) ==="
cd "${APP_DIR}" || log "WARNING: could not cd to ${APP_DIR}"

# ---------- 2) update_tenders_from_pdfs_fixed_v4.py ----------
if [ -f "${APP_DIR}/update_tenders_from_pdfs_fixed_v4.py" ]; then
  log "=== starting update_tenders_from_pdfs_fixed_v4.py ==="
  python3 "${APP_DIR}/update_tenders_from_pdfs_fixed_v4.py" >> "${LOG_DIR}/parser_loop.log" 2>&1 &
else
  log "NOTICE: update_tenders_from_pdfs_fixed_v4.py not found; skipping" >> "${LOG_DIR}/parser_loop.log"
fi
sleep 0.2

# ---------- 3) worker_matcher.py loop ----------
if [ -f "${APP_DIR}/worker_matcher.py" ]; then
  log "=== starting worker_matcher.py loop ==="
  (
    while true; do
      log "=== $(date -u) Starting worker_matcher.py ===" >> "${LOG_DIR}/matcher_worker.log"
      python3 "${APP_DIR}/worker_matcher.py" >> "${LOG_DIR}/matcher_worker.log" 2>&1 || true
      log "=== $(date -u) worker_matcher.py exited; sleeping 5s ===" >> "${LOG_DIR}/matcher_worker.log"
      sleep 5
    done
  ) &
elif [ -x "${DOCKER_SCRIPTS_DIR}/run_matcher_loop.sh" ]; then
  log "=== starting run_matcher_loop.sh ==="
  bash "${DOCKER_SCRIPTS_DIR}/run_matcher_loop.sh" >> "${LOG_DIR}/matcher_worker.log" 2>&1 &
else
  log "NOTICE: no matcher detected; skipping" >> "${LOG_DIR}/matcher_worker.log"
fi
sleep 0.2

# ---------- 4) Daily GeM scraper ----------
if [ -d "${APP_DIR}/gem-scraper" ]; then
  if [ -x "${DOCKER_SCRIPTS_DIR}/run_daily_gem_scraper.sh" ]; then
    log "=== starting daily gem scraper ==="
    bash "${DOCKER_SCRIPTS_DIR}/run_daily_gem_scraper.sh" >> "${LOG_DIR}/daily_scraper.log" 2>&1 &
  else
    log "NOTICE: run_daily_gem_scraper.sh missing; skipping" >> "${LOG_DIR}/daily_scraper.log"
  fi
else
  log "NOTICE: gem-scraper directory missing; skipping" >> "${LOG_DIR}/daily_scraper.log"
fi
sleep 0.2

# ---------- 5) Daily Backfill (07:00 IST = 01:30 UTC) ----------
log "=== starting daily backfill loop (07:00 IST) ==="

(
  BF_LOG="${LOG_DIR}/backfill_loop.log"
  while true; do
      NOW_UTC=$(date -u +%s)
      TARGET_UTC=$(date -u -d "today 01:30" +%s)

      # If 01:30 UTC has passed, schedule for tomorrow
      if [ "$TARGET_UTC" -le "$NOW_UTC" ]; then
          TARGET_UTC=$(date -u -d "tomorrow 01:30" +%s)
      fi

      SLEEP_SECS=$(( TARGET_UTC - NOW_UTC ))

      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ⏳ Backfill sleeping $SLEEP_SECS sec until 07:00 IST" >> "$BF_LOG"
      sleep "$SLEEP_SECS"

      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ▶ Starting daily backfill" >> "$BF_LOG"

      python3 backfill_tenders_from_storage.py >> "$BF_LOG" 2>&1 \
        || echo "$(date -u) ❌ Backfill returned non-zero" >> "$BF_LOG"
  done
) &
sleep 0.2

log "=== background processes started ==="
ps -eo pid,etime,cmd --sort=pid | sed -n '1,200p'

log "=== tailing logs (${LOG_DIR}/*.log) ==="

# ---------- 1) Node backend ----------
if [ -f "${APP_DIR}/dist/index.js" ]; then
  log "=== starting node backend ==="
  exec node dist/index.js
else
  log "WARNING: node dist/index.js not found; skipping node start" >> "${LOG_DIR}/node.log"
fi