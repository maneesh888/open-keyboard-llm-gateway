# Apfel Web Portal Dropdown Study + PoC

Date: 2026-06-02
Project: `open-keyboard-llm-gateway`

## Ask

Maneesh asked whether Apfel can be added to the gateway web portal with an option in the model dropdown, and requested a study + PoC.

## Summary

Feasible.

Apfel exposes Apple's on-device Foundation Models through an OpenAI-compatible HTTP server. The gateway already proxies OpenAI-shaped `/v1/*` requests after authenticating gateway API keys, so Apfel can be integrated as a second upstream backend with small routing changes.

## Apfel facts from research

Sources checked:

- `https://github.com/Arthur-Ficial/apfel`
- `https://raw.githubusercontent.com/Arthur-Ficial/apfel/main/README.md`
- `https://raw.githubusercontent.com/Arthur-Ficial/apfel/main/docs/guides/python.md`
- `https://raw.githubusercontent.com/Arthur-Ficial/apfel/main/docs/install.md`

Relevant details:

- Install: `brew install apfel`
- Serve mode: `apfel --serve`
- Default base URL: `http://localhost:11434/v1`
- Model id: `apple-foundationmodel`
- Supported endpoints:
  - `POST /v1/chat/completions`
  - `GET /v1/models`
  - `GET /health`
- Streaming and non-streaming chat are supported.
- It can require its own token if started with `--token`, but token is optional.
- Requires Apple Silicon, macOS 26 Tahoe+, and Apple Intelligence enabled.
- The model has a 4096-token context window; output can finish with `finish_reason: length` if too much context/output is requested.
- Embeddings and legacy completions are not supported.

## PoC implemented

Changed files:

- `src/types/index.ts`
  - Added optional `apfelHost?: string` to `AppConfig`.
- `src/index.ts`
  - Reads `APFEL_HOST` into fallback runtime config.
  - Logs when Apfel backend is enabled.
- `src/server.ts`
  - Passes `config.apfelHost` into the proxy.
- `src/proxy/ollama.ts`
  - Keeps existing Ollama routing unchanged.
  - Adds optional Apfel host.
  - Adds Apfel `/v1/models` result into admin model list when reachable.
  - Routes `model: "apple-foundationmodel"` requests to Apfel instead of Ollama.
- `config/config.example.json`
  - Documents `apfelHost`.
- `tests/proxy.test.ts`
  - Added regression tests for:
    - routing `apple-foundationmodel` to Apfel
    - showing Apfel model in model list when reachable

## How dropdown support works

The existing admin portal model dropdown already populates from:

```text
GET /admin/models
```

That endpoint calls `proxy.listModels()`.

The PoC extends `listModels()` so that when `apfelHost` is configured and reachable, `apple-foundationmodel` is included alongside Ollama models. No separate UI rewrite is needed for the first version.

Expected result in portal:

```text
Model dropdown:
- gemma4:latest
- ...loaded/cloud Ollama models...
- apple-foundationmodel
```

When an API key is configured with `modelConfig.model = "apple-foundationmodel"`, client chat completion requests are proxied to Apfel.

## Config shape

Example:

```json
{
  "port": 8080,
  "ollamaHost": "http://host.docker.internal:11434",
  "apfelHost": "http://host.docker.internal:11435",
  "logLevel": "info",
  "corsOrigins": ["*"]
}
```

Or env fallback:

```bash
APFEL_HOST=http://host.docker.internal:11435 npm start
```

Important: Apfel and Ollama both default to port `11434`. If both run on the same Mac, one must be moved to a different port or only one can own `11434` at a time.

## Verification run

Commands run locally in Docker:

```bash
npm test
npm run build
```

Results:

- `npm test`: pass — 8 files, 75 tests
- `npm run build`: pass

## Host validation

ClawMaster validated the PoC on the host Mac because Apfel requires macOS + Apple Intelligence:

- Host compatibility was sufficient: macOS 26.5 arm64, Xcode 26.0.
- `brew install apfel` succeeded and installed Apfel v1.5.0 at `/opt/homebrew/bin/apfel`.
- Ollama was already listening on `127.0.0.1:11434`, so Apfel was started on `127.0.0.1:11435`.
- Apfel `/health` returned OK with `model_available: true`.
- Apfel `/v1/models` returned `apple-foundationmodel`.
- Apfel `/v1/chat/completions` returned a short response (`Apfel ok`).
- Gateway test run with `APFEL_HOST=http://127.0.0.1:11435 npm test` passed: 8 files, 75 tests.
- Temporary gateway `/admin/models` returned `apple-foundationmodel` plus existing Ollama models.

Remaining product checks: create a real Open Keyboard key using `apple-foundationmodel`, run live keyboard actions against the host gateway, and evaluate latency/quality for common rewrite/fix-grammar prompts.

## Product fit for Open Keyboard

Pros:

- No per-token cloud cost.
- Privacy-first local model option.
- Good for smoke tests and offline-ish demos.
- OpenAI-compatible API means small gateway changes.

Cons / risks:

- Host-only; iPhone cannot directly use Mac-local Apfel unless gateway is reachable from device/network.
- Apple Intelligence/macOS version requirements may be strict.
- 3B-ish local model quality may be weaker than cloud models.
- 4096-token context means shorter prompts and outputs.
- Port collision with Ollama default `11434`.
- If exposed publicly through our gateway, we must treat it like any upstream and keep gateway auth/rate limits in front.

## Recommended next step

1. Keep Apfel on a non-conflicting port such as `11435` when Ollama owns `11434`.
2. Set gateway `APFEL_HOST=http://host.docker.internal:11435` or config `apfelHost`.
3. Create a test key using `apple-foundationmodel`.
4. Run live chat smoke + Open Keyboard live UI action tests against that key.
5. Evaluate output quality and latency before making Apfel a default user-facing option.

## Decision

Technically feasible. The gateway/portal PoC compiles, passes tests, and host validation confirms the admin model list can include `apple-foundationmodel` without a UI rewrite.
