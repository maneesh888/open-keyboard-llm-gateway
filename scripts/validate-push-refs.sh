#!/usr/bin/env bash
set -euo pipefail

EXPECTED_HEAD="${1:-}"
ZERO_SHA="0000000000000000000000000000000000000000"
SAW_REF=false

[[ "$EXPECTED_HEAD" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Pre-push validation requires the full checked-out HEAD SHA." >&2
  exit 2
}

while read -r local_ref local_sha remote_ref remote_sha; do
  [[ -n "${local_ref:-}" ]] || continue
  SAW_REF=true

  if [[ "$local_sha" == "$ZERO_SHA" ]]; then
    echo "Pre-push does not validate remote ref deletion: $remote_ref" >&2
    exit 1
  fi
  if [[ ! "$local_sha" =~ ^[0-9a-f]{40}$ || "$local_sha" != "$EXPECTED_HEAD" ]]; then
    echo "Pre-push only permits refs bound to checked-out HEAD: $local_ref" >&2
    exit 1
  fi
done

if [[ "$SAW_REF" != "true" ]]; then
  echo "Pre-push received no ref update to validate." >&2
  exit 1
fi

echo "All pushed refs are bound to checked-out HEAD $EXPECTED_HEAD."
