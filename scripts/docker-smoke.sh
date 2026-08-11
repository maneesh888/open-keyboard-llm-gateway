#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHORT_SHA="$(git -C "$ROOT" rev-parse --short=12 HEAD 2>/dev/null || echo local)"
IMAGE_TAG="llm-gateway-ci:$SHORT_SHA"
CONTAINER_NAME="llm-gateway-ci-$SHORT_SHA-$$"
RESULTS_DIRECTORY="$ROOT/.ci-results"
mkdir -p "$RESULTS_DIRECTORY"
FIXTURE_DIRECTORY="$(mktemp -d "$RESULTS_DIRECTORY/docker-smoke.XXXXXX")"
CONTAINER_STARTED=false

cleanup() {
  if [[ "$CONTAINER_STARTED" == "true" ]]; then
    docker rm --force "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$FIXTURE_DIRECTORY"
}
trap cleanup EXIT

cat > "$FIXTURE_DIRECTORY/config.json" <<'JSON'
{
  "port": 8080,
  "ollamaHost": "http://127.0.0.1:9",
  "logLevel": "error",
  "corsOrigins": ["*"]
}
JSON

cat > "$FIXTURE_DIRECTORY/keys.json" <<'JSON'
{
  "keys": [
    {
      "id": "ci-smoke",
      "name": "CI smoke",
      "key": "ci-placeholder",
      "enabled": true,
      "allowedModels": ["*"],
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ]
}
JSON

docker compose -f "$ROOT/docker-compose.yml" config --quiet
docker build --tag "$IMAGE_TAG" "$ROOT"

docker run --detach \
  --name "$CONTAINER_NAME" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --publish 127.0.0.1::8080 \
  --volume "$FIXTURE_DIRECTORY/config.json:/app/config/config.json:ro" \
  --volume "$FIXTURE_DIRECTORY/keys.json:/app/config/keys.json:ro" \
  --env ADMIN_CONFIG_PATH=/app/config/admin-disabled.json \
  "$IMAGE_TAG" >/dev/null
CONTAINER_STARTED=true

PORT_OUTPUT="$(docker port "$CONTAINER_NAME" 8080/tcp)"
GATEWAY_PORT="${PORT_OUTPUT##*:}"
[[ "$GATEWAY_PORT" =~ ^[0-9]+$ ]] || {
  echo "Could not resolve the published gateway port from: $PORT_OUTPUT" >&2
  exit 1
}

HEALTH_BODY=""
for attempt in $(seq 1 30); do
  if HEALTH_BODY="$(curl --fail --silent --show-error --max-time 3 "http://127.0.0.1:$GATEWAY_PORT/health" 2>/dev/null)"; then
    break
  fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER_NAME")" != "true" ]]; then
    echo "Gateway container stopped before becoming ready." >&2
    docker logs "$CONTAINER_NAME" >&2
    exit 1
  fi
  sleep 1
done

[[ "$HEALTH_BODY" == *'"status":"ok"'* ]] || {
  echo "Gateway health endpoint did not report status ok: $HEALTH_BODY" >&2
  exit 1
}
[[ "$HEALTH_BODY" == *'"ollama":"disconnected"'* ]] || {
  echo "Gateway smoke expected an intentionally disconnected test backend: $HEALTH_BODY" >&2
  exit 1
}

UI_BODY="$(curl --fail --silent --show-error --max-time 3 "http://127.0.0.1:$GATEWAY_PORT/ui")"
[[ "$UI_BODY" == *'<title>LLM Gateway · Admin</title>'* ]] || {
  echo "Gateway admin UI did not return the expected document." >&2
  exit 1
}

echo "Docker smoke passed: image starts as non-root, /health is reachable, and /ui is served."
echo "Proof boundary: the fixture backend is intentionally disconnected; no live model call was made."
