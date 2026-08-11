#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXPECTED_HEAD="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
OTHER_HEAD="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
ZERO_SHA="0000000000000000000000000000000000000000"
REMOTE_HEAD="cccccccccccccccccccccccccccccccccccccccc"

printf '%s %s %s %s\n' \
  refs/heads/current "$EXPECTED_HEAD" refs/heads/current "$REMOTE_HEAD" |
  "$ROOT/scripts/validate-push-refs.sh" "$EXPECTED_HEAD" >/dev/null

if printf '%s %s %s %s\n' \
  refs/heads/other "$OTHER_HEAD" refs/heads/other "$REMOTE_HEAD" |
  "$ROOT/scripts/validate-push-refs.sh" "$EXPECTED_HEAD" >/dev/null 2>&1; then
  echo "push-ref policy accepted a commit other than checked-out HEAD." >&2
  exit 1
fi

if printf '%s %s %s %s\n' \
  '(delete)' "$ZERO_SHA" refs/heads/other "$REMOTE_HEAD" |
  "$ROOT/scripts/validate-push-refs.sh" "$EXPECTED_HEAD" >/dev/null 2>&1; then
  echo "push-ref policy accepted an unvalidated remote deletion." >&2
  exit 1
fi

if "$ROOT/scripts/validate-push-refs.sh" "$EXPECTED_HEAD" </dev/null >/dev/null 2>&1; then
  echo "push-ref policy accepted empty ref input." >&2
  exit 1
fi

echo "Push-ref policy test passed."
