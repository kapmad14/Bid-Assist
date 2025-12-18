#!/usr/bin/env bash
# Runs final_update_tenders_from_pdfs.py every 8 hours
# Automatically processes only new PDFs in the tenders table

set -euo pipefail

APP_DIR="/app"
LOG_DIR="${APP_DIR}/logs"
PARSER_FILE="${APP_DIR}/final_update_tenders_from_pdfs.py"

# Ensure working directory exists
cd "${APP_DIR}" || {
    echo "ERROR: Could not cd to ${APP_DIR}"
    exit 1
}

mkdir -p "${LOG_DIR}"

# Confirm the parser exists before entering infinite loop
if [[ ! -f "${PARSER_FILE}" ]]; then
    echo "ERROR: Parser file not found: ${PARSER_FILE}"
    exit 1
fi

while true; do
    timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    echo "=== ${timestamp} Starting final PDF parser ===" \
        >> "${LOG_DIR}/parser_loop.log" 2>&1

    # Execute parser — errors do NOT stop the loop
    if python3 "${PARSER_FILE}" >> "${LOG_DIR}/parser_loop.log" 2>&1; then
        echo "=== Parser completed successfully at ${timestamp} ===" \
            >> "${LOG_DIR}/parser_loop.log"
    else
        echo "=== Parser returned non-zero at ${timestamp} ===" \
            >> "${LOG_DIR}/parser_loop.log"
    fi

    echo "=== ${timestamp} Finished. Sleeping 28800s (8 hours) ===" \
        >> "${LOG_DIR}/parser_loop.log" 2>&1

    sleep 28800  # 8 hours
done
