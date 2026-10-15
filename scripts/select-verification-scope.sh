#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
case "${1:-}" in
  --staged)
    [[ "$#" == 1 ]] || exit 2
    TRUSTED_SHA="$(git rev-parse --verify 'HEAD^{commit}')"
    ;;
  --range)
    [[ "$#" == 3 && "$2" != -* && "$3" != -* ]] || exit 2
    TRUSTED_SHA="$(git rev-parse --verify "$2^{commit}")"
    git rev-parse --verify "$3^{commit}" >/dev/null
    git merge-base "$2" "$3" >/dev/null
    ;;
  *) exit 2 ;;
esac
# Older bases cannot authorize reduced checks. Never execute candidate policy as a fallback.
if ! git cat-file -e "$TRUSTED_SHA:scripts/verification-scope.mjs" 2>/dev/null; then
  echo full
  exit 0
fi
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_ROOT"' EXIT
git show "$TRUSTED_SHA:scripts/verification-scope.mjs" > "$TEMP_ROOT/scope.mjs"
SCOPE="$(node "$TEMP_ROOT/scope.mjs" "$@")"
case "$SCOPE" in
  docs|full) echo "$SCOPE" ;;
  *) echo 'Trusted verification scope returned an invalid result.' >&2; exit 1 ;;
esac
