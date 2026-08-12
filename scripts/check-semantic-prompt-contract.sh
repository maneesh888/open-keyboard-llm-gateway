#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_ROOT="$ROOT/Vendor/semantic-prompt-contract"

[[ -f "$CONTRACT_ROOT/contracts/manifest.json" ]] || {
  echo "semantic-prompt-contract is missing; initialize pinned submodules." >&2
  exit 1
}

SUBMODULE_STATE="$(git -C "$ROOT" submodule status -- Vendor/semantic-prompt-contract)"
[[ "$SUBMODULE_STATE" != [-+U]* ]] || {
  echo "semantic-prompt-contract does not match the pinned gitlink." >&2
  exit 1
}

if rg --quiet \
  'one atomic correction result per distinct issue|Return strict JSON only with this exact top-level contract' \
  "$ROOT/src" "$ROOT/public"; then
  echo "Canonical semantic prompt wording must not be copied into gateway production sources." >&2
  exit 1
fi

npm ci --prefix "$CONTRACT_ROOT"
npm run check --prefix "$CONTRACT_ROOT"
