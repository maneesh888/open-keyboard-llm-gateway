#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE_REPOSITORY="$(mktemp -d)"

cleanup() {
  rm -rf -- "$FIXTURE_REPOSITORY"
}
trap cleanup EXIT

git -C "$FIXTURE_REPOSITORY" init --quiet
git -C "$FIXTURE_REPOSITORY" config user.email ci@example.invalid
git -C "$FIXTURE_REPOSITORY" config user.name "CI Fixture"
printf '%s\n' 'safe content' > "$FIXTURE_REPOSITORY/safe.txt"
git -C "$FIXTURE_REPOSITORY" add safe.txt

mkdir -p "$FIXTURE_REPOSITORY/config"
printf '%s\n' '{"jwtSecret":"REPLACE_WITH_LONG_RANDOM_SECRET_32_BYTES_MINIMUM"}' > \
  "$FIXTURE_REPOSITORY/config/admin.example.json"
git -C "$FIXTURE_REPOSITORY" add config/admin.example.json

LLM_GATEWAY_REPOSITORY_ROOT="$FIXTURE_REPOSITORY" \
  node "$ROOT/scripts/secret-scan.mjs" >/dev/null

secret_value="sk-$(printf 'a%.0s' {1..24})"
printf 'export const token = "%s";\n' "$secret_value" > "$FIXTURE_REPOSITORY/leak.ts"
git -C "$FIXTURE_REPOSITORY" add leak.ts

if LLM_GATEWAY_REPOSITORY_ROOT="$FIXTURE_REPOSITORY" \
  node "$ROOT/scripts/secret-scan.mjs" >/dev/null 2>&1; then
  echo "secret scan fixture unexpectedly accepted a sensitive token." >&2
  exit 1
fi

git -C "$FIXTURE_REPOSITORY" rm --force --quiet leak.ts

example_secret="sk-$(printf 'b%.0s' {1..24})"
printf 'OPENAI_API_KEY=%s\n' "$example_secret" > "$FIXTURE_REPOSITORY/.env.example"
git -C "$FIXTURE_REPOSITORY" add .env.example

if LLM_GATEWAY_REPOSITORY_ROOT="$FIXTURE_REPOSITORY" \
  node "$ROOT/scripts/secret-scan.mjs" >/dev/null 2>&1; then
  echo "secret scan fixture unexpectedly accepted a secret in an example file." >&2
  exit 1
fi

echo "Secret scan policy test passed."
