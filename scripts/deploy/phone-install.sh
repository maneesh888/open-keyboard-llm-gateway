#!/bin/sh
set -u

revision="${1:-}"
expected_digest="${2:-}"
artifact="${3:-}"
base_url="${4:-}"
app_root=/opt/oneplus-llm/app
lock_dir=/run/lock/llm-gateway-deploy.lock
work_dir="/opt/oneplus-llm/.deploy-${revision}-$$"
backup=
swapped=0
config_before="$work_dir/config.before"
config_after="$work_dir/config.after"

fail() {
  printf '%s\n' "phone deployment stopped: $1" >&2
  return 1
}

cleanup() {
  rm -rf -- "$work_dir"
  rmdir "$lock_dir" 2>/dev/null || true
}

interrupted() {
  if [ "$swapped" -eq 1 ]; then
    rollback >/dev/null 2>&1 || true
  fi
  cleanup
  exit 130
}

config_fingerprint() {
  destination=$1
  find /etc/oneplus-llm -xdev -type f -exec sha256sum {} \; | LC_ALL=C sort > "$destination"
}

status_code() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 10 "$1"
}

checks_pass() {
  [ "$(status_code "$base_url/health")" = 200 ] || return 1
  [ "$(status_code "$base_url/ui")" = 200 ] || return 1
  [ "$(status_code "$base_url/v1/models")" = 401 ] || return 1
  config_fingerprint "$config_after" || return 1
  cmp -s "$config_before" "$config_after" || return 1
}

rollback() {
  rc-service oneplus-llm stop >/dev/null 2>&1 || true
  if [ -d "$app_root" ]; then
    mv "$app_root" "${app_root}.failed-${revision}-$$" 2>/dev/null || true
  fi
  if [ -n "$backup" ] && [ -d "$backup" ]; then
    mv "$backup" "$app_root" || return 1
  else
    return 1
  fi
  rc-service oneplus-llm start >/dev/null 2>&1 || return 1
  i=0
  while [ "$i" -lt 30 ]; do
    if [ "$(status_code "$base_url/health" 2>/dev/null || true)" = 200 ]; then
      printf '%s\n' 'deployment_status=rolled_back'
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

deploy() {
  case "$revision" in *[!0-9a-f]*|'') fail 'invalid revision'; return 1;; esac
  [ "${#revision}" -eq 40 ] || { fail 'revision must be full length'; return 1; }
  case "$expected_digest" in *[!0-9a-f]*|'') fail 'invalid artifact digest'; return 1;; esac
  [ "${#expected_digest}" -eq 64 ] || { fail 'artifact digest must be full length'; return 1; }
  case "$base_url" in http://192.168.1.130:8880) :;; *) fail 'unexpected target URL'; return 1;; esac
  [ "$(id -u)" -eq 0 ] || { fail 'installer must run as root'; return 1; }
  [ -f "$artifact" ] || { fail 'artifact is missing'; return 1; }
  [ -d "$app_root" ] || { fail 'existing app is missing'; return 1; }
  [ -d /etc/oneplus-llm ] || { fail 'existing configuration is missing'; return 1; }
  rc-service oneplus-llm status >/dev/null 2>&1 || { fail 'service is not started'; return 1; }
  mkdir "$lock_dir" 2>/dev/null || { fail 'remote deployment lock is held'; return 1; }
  trap cleanup EXIT
  trap interrupted HUP INT TERM
  mkdir -m 0700 "$work_dir" || return 1
  printf '%s  %s\n' "$expected_digest" "$artifact" | sha256sum -c - >/dev/null 2>&1 || { fail 'artifact digest mismatch'; return 1; }
  config_fingerprint "$config_before" || return 1

  python3 -B - "$artifact" "$work_dir" <<'PY'
import os, pathlib, sys, tarfile
archive, destination = sys.argv[1:]
root = pathlib.Path(destination).resolve()
with tarfile.open(archive, 'r:gz') as handle:
    for member in handle.getmembers():
        target = (root / member.name).resolve()
        if root != target and root not in target.parents:
            raise SystemExit('unsafe archive path')
        if member.isdev() or member.isfifo():
            raise SystemExit('unsupported archive entry')
        if member.mode & 0o6000:
            raise SystemExit('privileged archive mode')
        if member.issym() or member.islnk():
            link_target = (target.parent / member.linkname).resolve()
            if root != link_target and root not in link_target.parents:
                raise SystemExit('unsafe archive link')
    handle.extractall(root)
PY
  [ "$?" -eq 0 ] || { fail 'safe artifact extraction failed'; return 1; }
  candidate="$work_dir/app"
  [ -f "$candidate/dist/index.js" ] || { fail 'candidate entry point is missing'; return 1; }
  [ -f "$candidate/RELEASE.json" ] || { fail 'candidate release metadata is missing'; return 1; }
  python3 -B - "$candidate/RELEASE.json" "$revision" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as handle:
    release = json.load(handle)
if release.get('git_revision') != sys.argv[2]:
    raise SystemExit(1)
if release.get('target') != 'existing phone Linux arm64 Node 24 runtime':
    raise SystemExit(1)
PY
  [ "$?" -eq 0 ] || { fail 'candidate release metadata does not match'; return 1; }

  if [ -e "$app_root/KEEPALIVE_OVERRIDE.json" ]; then
    [ -e "$candidate/KEEPALIVE_OVERRIDE.json" ] || { fail 'phone keep-alive override is missing from candidate'; return 1; }
    cmp -s "$app_root/KEEPALIVE_OVERRIDE.json" "$candidate/KEEPALIVE_OVERRIDE.json" || { fail 'phone keep-alive override changed'; return 1; }
  fi

  old_revision=$(python3 -B - "$app_root/RELEASE.json" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as handle:
        value = json.load(handle).get('git_revision', 'unknown')
except Exception:
    value = 'unknown'
print(value if isinstance(value, str) and value.replace('-', '').isalnum() else 'unknown')
PY
  )
  backup="/opt/oneplus-llm/app.rollback-${old_revision}-$(date -u +%Y%m%dT%H%M%SZ)"
  [ ! -e "$backup" ] || { fail 'rollback path already exists'; return 1; }
  chown -R root:root "$candidate" || return 1
  chmod -R go-w "$candidate" || return 1
  rc-service oneplus-llm stop >/dev/null 2>&1 || {
    rc-service oneplus-llm start >/dev/null 2>&1 || true
    fail 'service did not stop'
    return 1
  }
  mv "$app_root" "$backup" || return 1
  swapped=1
  mv "$candidate" "$app_root" || return 1
  rc-service oneplus-llm start >/dev/null 2>&1 || return 1
  i=0
  while [ "$i" -lt 30 ]; do
    if checks_pass; then
      printf '%s\n' "deployment_status=deployed revision=$revision rollback_bundle=$(basename "$backup")"
      swapped=0
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

if deploy; then
  exit 0
fi

if [ "$swapped" -eq 1 ] && rollback; then
  exit 1
fi
if [ "$swapped" -eq 1 ]; then
  printf '%s\n' 'deployment_status=rollback_failed' >&2
else
  printf '%s\n' 'deployment_status=not_applied' >&2
fi
exit 1
