#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
EXPECTED_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_PATH="$(git -C "$ROOT" config --local --get core.hooksPath || true)"

[[ "$ROOT" == "$EXPECTED_ROOT" ]] || {
  echo "Run this script from the LLM Gateway repository." >&2
  exit 1
}

"$ROOT/scripts/check-environment.sh" --hygiene

if [[ -n "$HOOKS_PATH" && "$HOOKS_PATH" != ".githooks" ]]; then
  echo "A different core.hooksPath is already configured: $HOOKS_PATH" >&2
  exit 1
fi

chmod +x "$ROOT/.githooks/pre-commit" "$ROOT/.githooks/pre-push"
git -C "$ROOT" config --local core.hooksPath .githooks

echo "LLM Gateway pre-commit and pre-push hooks enabled from .githooks/."
