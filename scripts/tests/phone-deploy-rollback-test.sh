#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$(mktemp -d)"
SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

cleanup() {
  rm -rf -- "$FIXTURE"
}
trap cleanup EXIT

mkdir -p "$FIXTURE/root/opt/oneplus-llm/app/dist" \
  "$FIXTURE/root/etc/oneplus-llm" "$FIXTURE/root/run/lock" "$FIXTURE/bin" \
  "$FIXTURE/candidate/app/dist"
printf '%s\n' '{"git_revision":"old-revision","target":"existing phone Linux arm64 Node 24 runtime"}' > \
  "$FIXTURE/root/opt/oneplus-llm/app/RELEASE.json"
printf '%s\n' '{"policy":"keep-alive"}' > "$FIXTURE/root/opt/oneplus-llm/app/KEEPALIVE_OVERRIDE.json"
printf '%s\n' 'old entry' > "$FIXTURE/root/opt/oneplus-llm/app/dist/index.js"
printf '%s\n' 'private fixture value' > "$FIXTURE/root/etc/oneplus-llm/keys.json"

printf '%s\n' "{\"git_revision\":\"$SHA\",\"target\":\"existing phone Linux arm64 Node 24 runtime\"}" > \
  "$FIXTURE/candidate/app/RELEASE.json"
printf '%s\n' '{"policy":"keep-alive"}' > "$FIXTURE/candidate/app/KEEPALIVE_OVERRIDE.json"
printf '%s\n' '{"name":"fixture"}' > "$FIXTURE/candidate/app/package.json"
printf '%s\n' 'candidate entry' > "$FIXTURE/candidate/app/dist/index.js"
tar -C "$FIXTURE/candidate" -czf "$FIXTURE/release.tar.gz" app
DIGEST="$(shasum -a 256 "$FIXTURE/release.tar.gz" | awk '{print $1}')"

cat > "$FIXTURE/bin/rc-service" <<'SH'
#!/bin/sh
printf '%s\n' "$*" >> "$PHONE_DEPLOY_SERVICE_LOG"
exit 0
SH
cat > "$FIXTURE/bin/curl" <<'SH'
#!/bin/sh
for argument in "$@"; do url=$argument; done
case "$url" in
  */v1/models) code=401;;
  *) code=200;;
esac
if grep -q 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' "$LLM_GATEWAY_DEPLOY_TEST_ROOT/opt/oneplus-llm/app/RELEASE.json" &&
   [ "${PHONE_DEPLOY_FAIL_CANDIDATE:-0}" = 1 ] && [ "$url" = 'http://192.168.1.130:8880/health' ]; then
  code=503
fi
printf '%s' "$code"
SH
chmod +x "$FIXTURE/bin/rc-service" "$FIXTURE/bin/curl"

set +e
OUTPUT="$(PATH="$FIXTURE/bin:$PATH" \
  LLM_GATEWAY_DEPLOY_TESTING=1 \
  LLM_GATEWAY_DEPLOY_TEST_ROOT="$FIXTURE/root" \
  PHONE_DEPLOY_SERVICE_LOG="$FIXTURE/service.log" \
  PHONE_DEPLOY_FAIL_CANDIDATE=1 \
  "$ROOT/scripts/deploy/phone-install.sh" \
    "$SHA" "$DIGEST" "$FIXTURE/release.tar.gz" 'http://192.168.1.130:8880' 2>&1)"
STATUS=$?
set -e

[[ "$STATUS" -ne 0 ]] || { echo 'phone rollback fixture unexpectedly succeeded' >&2; exit 1; }
[[ "$OUTPUT" == *'deployment_status=rolled_back'* ]] || { echo 'phone rollback status was not sanitized/confirmed' >&2; exit 1; }
rg --quiet 'old-revision' "$FIXTURE/root/opt/oneplus-llm/app/RELEASE.json" || { echo 'previous phone app was not restored' >&2; exit 1; }
[[ "$(cat "$FIXTURE/root/etc/oneplus-llm/keys.json")" == 'private fixture value' ]] || { echo 'phone configuration changed' >&2; exit 1; }
[[ "$(rg -c '^oneplus-llm start$' "$FIXTURE/service.log")" -ge 2 ]] || { echo 'previous phone service was not restarted' >&2; exit 1; }

echo 'Phone deployment rollback fixture passed.'
