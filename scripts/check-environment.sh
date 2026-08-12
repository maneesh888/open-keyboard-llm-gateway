#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:---hygiene}"

fail() {
  echo "environment check failed: $1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required for $MODE checks."
}

case "$MODE" in
  --hygiene|--quick|--full)
    ;;
  *)
    fail "unknown mode $MODE (expected --hygiene, --quick, or --full)."
    ;;
esac

for command_name in git node npm rg ruby; do
  require_command "$command_name"
done

REPOSITORY_ROOT="$(git -C "$ROOT" rev-parse --show-toplevel 2>/dev/null)" ||
  fail "the repository root could not be resolved."
[[ "$REPOSITORY_ROOT" == "$ROOT" ]] || fail "run checks from the LLM Gateway repository."

[[ -f "$ROOT/package-lock.json" ]] || fail "package-lock.json is required for reproducible npm and Docker builds."
if git -C "$ROOT" check-ignore --quiet package-lock.json; then
  fail "package-lock.json must not be ignored."
fi

if [[ "$MODE" == "--full" ]]; then
  require_command docker
  require_command curl
  docker info >/dev/null 2>&1 || fail "the Docker daemon is required for full checks."
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required for full checks."
fi

echo "Environment check passed for $MODE with Node $(node --version)."
