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
  - Admin auth guard, list sanitize, get, create, update, delete, missing-key paths.
- `tests/admin/ui-static.test.ts`
  - Admin UI responsive/static wiring contract.

## Known Test Harness Issue

Running plain `npm test` currently also collects Playwright E2E specs inside `.claude/worktrees/...`, causing Vitest suite failures unrelated to production code. Use targeted Vitest paths until config excludes `.claude` worktrees.
