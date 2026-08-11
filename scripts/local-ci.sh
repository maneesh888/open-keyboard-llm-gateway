#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIRECTORY="$ROOT/.ci-results"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"
LOG_FILE="$RESULTS_DIRECTORY/local-ci_$TIMESTAMP.log"
MODE="${1:---quick}"

mkdir -p "$RESULTS_DIRECTORY"

run_step() {
  local name="$1"
  shift

  echo "[local-ci] $name" | tee -a "$LOG_FILE"
  if "$@" 2>&1 | tee -a "$LOG_FILE"; then
    echo "[local-ci] PASS: $name" | tee -a "$LOG_FILE"
  else
    echo "[local-ci] FAIL: $name" | tee -a "$LOG_FILE" >&2
    echo "[local-ci] log: $LOG_FILE" >&2
    exit 1
  fi
}

case "$MODE" in
  --quick|--all)
    run_step "Vitest suite" npm test
    run_step "TypeScript build" npm run build
    ;;
  --test)
    run_step "Vitest suite" npm test
    ;;
  --build)
    run_step "TypeScript build" npm run build
    ;;
  --docker)
    run_step "Docker runtime smoke" "$ROOT/scripts/docker-smoke.sh"
    ;;
  --help|-h)
    echo "Usage: ./scripts/local-ci.sh [--quick|--all|--test|--build|--docker]"
    exit 0
    ;;
  *)
    echo "Unknown local CI mode: $MODE" >&2
    exit 2
    ;;
esac

echo "[local-ci] complete; log: $LOG_FILE"
