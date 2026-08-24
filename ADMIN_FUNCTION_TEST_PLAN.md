# LLM Gateway Admin/API Function Test Plan

## Public / Runtime

- `GET /health`
  - Expected: `200`, JSON `{ status: "ok", ollama: "connected" | "disconnected" }`.
- `GET /ui`
  - Expected: `200`, serves admin HTML.
  - Static contract: contains responsive markers (`table-wrap`, mobile media query, card `data-label`s).

## Admin Auth

- `POST /admin/login`
  - Valid credentials return `200` with `{ token, expiresIn }`.
  - Invalid credentials return `401`.

## Admin Key Management

All require `Authorization: Bearer <admin JWT>`.

- `GET /admin/keys`
  - Lists keys.
  - Must sanitize key values in list response.
- `GET /admin/keys/:id`
  - Returns the full key for one ID.
  - Missing ID returns `404`.
- `POST /admin/keys`
  - Creates a key.
  - Requires `name`.
  - Defaults rate/model/features when optional fields are missing.
- `PATCH /admin/keys/:id`
  - Updates mutable fields.
  - Must not allow `id` or raw `key` overwrite.
  - Missing ID returns `404`.
- `DELETE /admin/keys/:id`
  - Deletes a key.
  - Missing ID returns `404`.

## Admin Model Runtime

All require `Authorization: Bearer <admin JWT>`.

- `POST /admin/models/status`
  - Accepts one to 100 model identifiers and deduplicates them.
  - Uses only bounded provider metadata/health checks and returns `inferencePerformed: false`.
  - Separates model availability from API-key enablement and never claims live inference proof.
  - Returns common setup diagnostics with a stable code, safe message, and ordered recovery steps for platform, installation, credential, and controller failures.
- `POST /admin/models/start`
  - Accepts only a model identifier; client-supplied commands or process options are rejected.
  - Loads an installed idle local Ollama model with an empty bounded request when Ollama uses loopback or Docker's `host.docker.internal` target.
  - May start a fixed Ollama/Apfel CLI only when explicitly enabled and configured for loopback.
  - May start the macOS Apfel Homebrew service through the authenticated loopback host controller.
  - Refuses start for arbitrary remote, cloud, disabled, and unconfigured providers.
- `POST /admin/models/stop`
  - Accepts only a model identifier; client-supplied commands or process options are rejected.
  - Unloads a running local Ollama model with a bounded `keep_alive: 0` request when Ollama uses loopback or Docker's `host.docker.internal` target.
  - Stops Apfel only through the authenticated loopback host controller's fixed Homebrew route.
  - Refuses stop for arbitrary remote, cloud, disabled, and unconfigured providers.

## LLM Proxy

Requires `Authorization: Bearer <client API key>`.

- `GET /v1/models`
  - Valid key + Ollama connected returns model list.
  - Missing/invalid/disabled key returns `401`.
- `POST /v1/chat/completions`
  - Valid key proxies to Ollama.
  - Model outside allowlist returns `403`.
  - Ollama down returns `503`; timeout returns `504`.
- Streaming chat requests preserve `text/event-stream`.

## Automated Coverage Added

- `tests/admin/routes.test.ts`
  - Admin auth guard, list sanitize, get, create, update, delete, missing-key paths, model-status, and model-start routes.
- `tests/admin/ui-static.test.ts`
  - Admin UI responsive/static wiring contract, separate key/model statuses, concise inference wording, and status/start/stop controls.
- `tests/model-runtime.test.ts`
  - Ollama loaded/idle/cloud behavior, empty start/stop requests, Apfel service lifecycle, loopback/Docker-host controls, validation, and deduplication.
- `tests/model-service-controller.test.ts`
  - Controller authentication, fixed routes, fixed Homebrew commands, and protected client request shape.

## Test Harness

`vitest.config.ts` excludes private agent worktrees (`.claude` and `.claire`) and E2E specs, so plain `npm test` is the canonical deterministic suite. The full release gate additionally builds and starts the Docker image with safe fixture configuration.
