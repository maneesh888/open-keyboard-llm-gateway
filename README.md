# LLM Gateway

Semantic diagnostics in the admin playground come from the pinned
`Vendor/semantic-prompt-contract` version `1.0.0` package. This path is a checkout of a separate
repository, and the gateway repository's immutable gitlink pins it to one exact commit/version. The
gateway owns transport, authentication, rate limits, logging, and provider routing; it preserves
client messages and does not inject application prompt instructions.

For a fresh checkout, clone with the submodule initialized:

```bash
git clone --recurse-submodules https://github.com/maneesh888/open-keyboard-llm-gateway.git
```

For an existing clone, or if `Vendor/semantic-prompt-contract` is empty, recover the pinned checkout
from the gateway repository root:

```bash
git submodule update --init --recursive
```

Contract validation requires Git and npm with Node.js `^22.12.0` or `^24.0.0`. Do not edit the
vendored checkout directly. Make contract changes in the standalone `semantic-prompt-contract`
repository, validate and version them there, then deliberately advance this repository's submodule
gitlink. Run `./scripts/check-semantic-prompt-contract.sh` after initialization and whenever the
pinned contract changes.

A self-hosted API gateway for routing AI requests through user-controlled infrastructure. It authenticates API keys, applies per-key limits, proxies OpenAI-compatible chat requests to local/private model backends, and provides an admin UI for managing keys and testing live requests.

> Companion backend for [Open Keyboard](../open-keyboard): the iOS keyboard uses this gateway for API-key auth, model discovery, rate limiting, and OpenAI-compatible chat completions while keeping infrastructure under user control.

## Current capabilities

- API-key authentication for `/v1/*` routes.
- Per-key rate limits, model defaults, enabled/disabled status, and owner metadata.
- Hot-reloaded key configuration for file-based local operation.
- Admin API and responsive admin web UI at `/ui`.
- API key dashboard with create, edit, disable, delete, reveal, copy, and test actions.
- Live LLM playground for validating a selected key against `/v1/chat/completions`.
- Transparent forwarding of client-owned Chat Completions messages and backend-supported response formats.
- Model discovery through the configured backend, with optional Apfel routing for `apple-foundationmodel` when configured.
- An opt-in, private/trusted-user Codex provider with explicit per-key grants and non-streaming Chat Completions support.
- JSON request logging without exposing Authorization headers.
- Cumulative hygiene/quick/full release gates, committed hooks, and read-only GitHub CI.

## Architecture

```
Client (iPhone/OpenClaw/etc.)
        │
        │  Bearer sk-xxx
        ▼
┌─────────────────────┐
│    LLM Gateway      │  :8080
│  ┌───────────────┐  │
│  │  Auth Check   │  │  validate key
│  ├───────────────┤  │
│  │ Rate Limiter  │  │  per-key limits
│  ├───────────────┤  │
│  │    Logger     │  │  JSON logs
│  ├───────────────┤  │
│  │Provider Router│  │  select Ollama, Apfel, or Codex
│  └───────────────┘  │
└─────────────────────┘
        │
        ▼
┌─────────────────────┐
│      Ollama         │  :11434
│  gemma4:26b-a4b...  │
└─────────────────────┘
```

Optional Apfel support can route `apple-foundationmodel` requests to an Apfel OpenAI-compatible server when `APFEL_HOST` or `apfelHost` is configured. See `docs/APFEL_PORTAL_POC.md` for the PoC notes and constraints.

Optional Codex support reserves the configured public alias (default `codex`) and maps it to a separately configured Codex model. It is intended only for private deployments and trusted users; do not expose it to public or untrusted multi-tenant clients.

## Screenshots

The screenshots below use approved, partially redacted local captures. Do not replace them with captures that expose real API keys, admin tokens, private prompts, or server paths.

### Admin key management

<img src="docs/screenshots/llm-gateway-api-keys.png" alt="LLM Gateway admin API key management screen showing client keys, model defaults, rate limits, and admin actions." width="900">

### Live request playground

<img src="docs/screenshots/llm-gateway-playground.png" alt="LLM Gateway playground screen showing a live chat request and successful model response." width="900">

## Setup

### 1. Bootstrap local config

For a fresh local machine, run one command from the repo root to set up config and start the gateway on localhost:

```bash
npm run dev:bootstrap
```

The bootstrap command installs npm dependencies, creates missing local runtime files, prompts for an admin UI password, writes `config/admin.json` with a bcrypt password hash and JWT secret, writes `config/config.json`, creates one enabled API key in `config/keys.json`, and starts the local gateway when run through `npm run dev:bootstrap`. It does not overwrite existing local config files and it does not print generated secrets.

To create the default key for a specific Ollama model and pull it during setup:

```bash
npm run dev:bootstrap -- --model llama3.2:latest --pull
```

Useful options:

```bash
npm run bootstrap
npm run bootstrap -- --ollama-host http://localhost:11434
npm run bootstrap -- --skip-install
LLM_GATEWAY_ADMIN_PASSWORD='use-a-long-local-password' npm run bootstrap
```

`npm run bootstrap` is setup-only and exits after writing any missing config. `npm run dev:bootstrap` runs the same setup and then keeps the gateway running in the foreground.

### 2. Run locally

```bash
npm run dev
```

Then open:

```bash
open http://localhost:8080/ui
```

### Manual setup

If you do not want the bootstrap script to generate local config, copy the examples and replace all placeholder secrets yourself:

```bash
cp config/keys.example.json config/keys.json
cp config/config.example.json config/config.json
cp config/admin.example.json config/admin.json
```

### Run with Docker

```bash
docker compose build
docker compose up -d
docker compose logs -f
```

### Optional private Codex provider

Codex is disabled by default. To opt in, copy the full `codex` object from `config/config.example.json`, set `enabled` to `true`, and replace `model` with an approved underlying Codex model available to the deployment service account. The stable client-facing alias remains separate:

```json
{
  "codex": {
    "enabled": true,
    "publicModel": "codex",
    "model": "replace-with-approved-codex-model",
    "timeoutMs": 120000,
    "maxConcurrent": 1,
    "maxQueue": 2,
    "maxInputChars": 32000,
    "maxOutputChars": 16000
  }
}
```

Provide the service credential only through the protected `CODEX_API_KEY` process environment. Do not put it in `config.json`, Compose files, command arguments, logs, or repository files, and never mount or copy a personal `~/.codex/auth.json`. A file config containing a Codex credential field is rejected.

Each invocation uses the pinned official `@openai/codex` runtime with fixed arguments, strict config validation, prompt input over stdin, read-only sandboxing, approval policy `never`, disabled shell, local-image, image-generation, model tool networking/integrations, an empty temporary working directory, a dedicated temporary `CODEX_HOME`, and ephemeral session storage. User/project config, rules, repository instructions, hooks, apps, memories, multi-agent tools, web search, and MCP/plugin state are absent or disabled; the temporary directories are removed after the turn. The Codex runtime still needs outbound access to the OpenAI service. Client requests cannot supply executable paths, CLI flags, working directories, or environment variables.

The Codex route accepts text messages plus `response_format: {"type":"json_object"}`. It forwards
only the client messages to the isolated turn and validates that JSON-object mode returns one
parseable object; it does not inject application instructions or support JSON Schema mode.

When Codex is enabled, authenticated `/v1/chat/completions` request bodies have a 1 MiB transport cap applied before JSON materialization. This cap also applies to Ollama or Apfel requests on that endpoint because the provider model is selected from the JSON body. The existing `maxInputChars` limit then bounds the prompt actually sent to Codex.

The implementation was checked against the current official [Codex SDK contract](https://learn.chatgpt.com/docs/codex-sdk) and [non-interactive CLI contract](https://learn.chatgpt.com/docs/non-interactive-mode). The TypeScript SDK is not used directly because its public interface does not expose the required ephemeral/config-isolation flags or bounded subprocess output capture. The gateway instead invokes the SDK's underlying official CLI contract through a fixed, bounded runner.

`/health` reports one of these Codex states without making a paid inference call:

- `disabled`: opt-in configuration is off.
- `configured/ready`: configuration, protected credential presence, and the pinned runtime are present.
- `unavailable`: Codex was enabled but the credential or runtime is missing.

`configured/ready` does not validate the credential, model entitlement, network path, billing, or live inference. Codex failure does not change the top-level health status or Ollama/Apfel routing.

## Managing Keys

Keys are defined in `config/keys.json` and hot-reloaded every 5 seconds — no restart needed.

**Add a key:**
```json
{
  "id": "key_003",
  "name": "My App",
  "key": "sk-my-app-secret",
  "enabled": true,
  "rateLimit": 60,
  "allowedModels": ["*"],
  "createdAt": "2026-04-14T00:00:00Z"
}
```

**Revoke a key:** set `"enabled": false` or remove the entry.

**Restrict models:** set `"allowedModels": ["gemma4:26b-a4b-it-q4_K_M"]` to limit which models a key can use.

**Grant Codex explicitly:** set `"allowedModels": ["codex"]` or include `"codex"` alongside other entries. `"allowedModels": ["*"]` does not authorize, discover, or execute Codex. This deliberate exception prevents a wildcard from exposing privileged agent execution.

**Use a lighter sub-model:** set `"modelConfig.model"` to the exact lighter model or sub-model exposed by your backend. Optional `"modelConfig.effort"` is only a request-level reasoning hint for compatible backends; the gateway does not infer hidden effort tiers.

## Admin API and Web UI

The gateway includes an admin API for managing API keys programmatically and a browser UI for common operations.

### 1. Enable Admin API

```bash
cp config/admin.example.json config/admin.json
# Edit config/admin.json before starting the server.
```

There are **no usable default admin credentials**. You must generate both values yourself:

- `passwordHash`: bcrypt hash of a strong admin password.
- `jwtSecret`: long random secret, at least 32 bytes.

Example bcrypt hash generation:

```bash
node -e "const bcrypt=require('bcryptjs'); bcrypt.hash(process.argv[1], 12).then(console.log)" 'replace-with-a-long-random-password'
```

Example JWT secret generation:

```bash
openssl rand -base64 48
```

Do not expose `/admin` or `/ui` to the internet without HTTPS, strong credentials, and either gateway admin login throttling or an external reverse proxy/WAF/auth layer.

Admin login throttling uses direct-connection scope by default. If you deploy behind a reverse proxy and want per-client IP throttling/logging, configure `trustedProxies` in `config/config.json` with only your trusted proxy CIDR ranges; forwarded IP headers are ignored unless that trusted-proxy mode is enabled.

### 2. Open the admin UI

```bash
npm run dev
open http://localhost:8080/ui
```

The UI supports:

- key dashboard totals for total, active, and disabled keys
- client credential management with reveal/copy controls
- per-key model, token, effort, temperature, and rate-limit settings
- enable/disable and delete actions
- responsive mobile navigation for API Keys and Playground
- live playground tests using the selected key and model
- a generic connection-smoke preset with editable system and user messages
- diagnostics for status, latency, selected key, request shape, and failure classification

### 3. Admin API Endpoints

All admin endpoints require authentication via JWT token.

#### Login

```bash
curl -X POST http://localhost:8080/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-strong-admin-password"}'

# Response:
# {
#   "token": "eyJhb...",
#   "expiresIn": 86400
# }
```

#### Create API Key

```bash
TOKEN="your-jwt-token-from-login"

curl -X POST http://localhost:8080/admin/keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "iOS App",
    "owner": "john@example.com",
    "description": "Production iOS keyboard",
    "rateLimitConfig": {
      "requestsPerMinute": 30,
      "burstAllowance": 10
    },
    "features": {
      "suggestions": true,
      "customActions": [
        {
          "id": "translate",
          "label": "Translate to Arabic",
          "prompt": "Translate the following text to Arabic:"
        }
      ]
    },
    "modelConfig": {
      "model": "gemma4:latest",
      "maxTokens": 100,
      "temperature": 0.7
    }
  }'

# Response:
# {
#   "id": "key_a1b2c3d4",
#   "key": "sk-a1b2c3d4e5f6...",
#   "name": "iOS App",
#   ...
# }
```

#### List All Keys

```bash
curl http://localhost:8080/admin/keys \
  -H "Authorization: Bearer $TOKEN"
```

#### Get Specific Key

```bash
curl http://localhost:8080/admin/keys/key_a1b2c3d4 \
  -H "Authorization: Bearer $TOKEN"
```

#### Update Key

```bash
curl -X PATCH http://localhost:8080/admin/keys/key_a1b2c3d4 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": false,
    "rateLimitConfig": {
      "requestsPerMinute": 60,
      "burstAllowance": 20
    }
  }'
```

#### Delete Key

```bash
curl -X DELETE http://localhost:8080/admin/keys/key_a1b2c3d4 \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Per-Client Configuration

Each API key can have custom configuration:

**Rate Limiting:**
- `requestsPerMinute`: Max requests per minute
- `burstAllowance`: Extra requests allowed in bursts

**Features:**
- `suggestions`: Enable/disable AI suggestions
- `customActions`: Client-specific actions (e.g., translate, formal tone)

**Model Config:**
- `model`: Default LLM model for this client
- `maxTokens`: Maximum response length
- `effort`: Optional reasoning-effort hint (`low`, `medium`, or `high`) for compatible backends
- `temperature`: Response creativity (0.0-1.0)

**Compatibility Profile:**
- `compatibilityProfile`: Optional per-key response profile. The only supported value is
  `universal-ai-connector`; leave it unset for normal additive OpenAI-compatible pass-through.

The Universal AI Connector profile is a fallback for reasoning models whose otherwise valid Chat
Completions responses include reasoning-only fields. It removes `reasoning`, `reasoning_content`,
and `reasoning_details` from assistant messages and streaming deltas without merging them into
visible content. It also rejects `response_format.type: "json_schema"` before contacting the
backend because the profile does not claim JSON Schema enforcement. Prefer assigning connector
keys to a non-reasoning model/provider with real JSON Schema support. See
[the compatibility contract](docs/OPENAI_COMPATIBILITY.md#universal-ai-connector-profile).

## Open Keyboard integration

LLM Gateway is designed to pair with Open Keyboard as its self-hosted backend:

- `GET /health` for connection checks.
- `GET /v1/models` for model discovery.
- `POST /v1/chat/completions` for grammar, rewrite, summarize, translate, and continuation actions.
- Bearer API keys created through the gateway admin UI/API.

Open Keyboard owns its operation-specific prompts and response parsing. A structured request uses
ordinary client-provided messages and can ask a compatible backend for JSON mode:

```json
{
  "model": "gemma4:latest",
  "operation": "fix_grammar",
  "input_text": "i has a apple",
  "messages": [
    {"role": "system", "content": "Client-owned JSON contract and safety rules"},
    {"role": "user", "content": "Client-owned fix_grammar instructions and input text"}
  ],
  "response_format": {"type": "json_object"},
  "stream": false
}
```

`operation` and `input_text` remain optional additive metadata for deployed-client compatibility, but
the gateway does not interpret them. It requires the standard `model` and `messages` fields, forwards
the client message array unchanged, and does not add system/user messages or rewrite assistant
content. `response_format` support is backend-dependent. Open Keyboard validates and parses the
assistant content; the gateway only validates the generic outer Chat Completions envelope.

More detail:

```text
docs/OPEN_KEYBOARD_CLIENT.md
```

## API Usage

Use the client base URL `https://host/v1`. The tested compatibility surface is `GET /v1/models` plus non-streaming and streaming `POST /v1/chat/completions`; see [the precise compatibility contract](docs/OPENAI_COMPATIBILITY.md). Other `/v1/*` routes may remain proxied for backward compatibility but are not covered by the OpenAI compatibility claim. `/v1/responses` is experimental pass-through behavior.

### Error responses

Every gateway-generated non-2xx JSON response uses the OpenAI-style nested error envelope with a stable code; see [Error responses](docs/OPENAI_COMPATIBILITY.md#errors).

```json
{ "error": { "message": "Missing Authorization header", "type": "authentication_error", "code": "missing_authorization" } }
```

```json
{ "error": { "message": "Rate limit exceeded", "type": "rate_limit_error", "code": "rate_limit_exceeded" }, "retryAfter": 2, "limit": 10, "remaining": 0 }
```

```json
{ "error": { "message": "Upstream model request failed.", "type": "server_error", "code": "upstream_error" }, "upstreamStatus": 500 }
```

| Code | Meaning |
|---|---|
| `missing_authorization` | The gateway API-key Authorization header is missing. |
| `invalid_authorization_format` | The API-key Authorization header is not in Bearer format. |
| `invalid_api_key` | The gateway API key is invalid or disabled. |
| `rate_limit_exceeded` | The API key's request limit has been exceeded. |
| `upstream_unreachable` | The configured model backend could not be reached or queried. |
| `upstream_timeout` | The model backend request timed out. |
| `upstream_error` | The model backend returned a non-success or invalid protocol response. |
| `stream_not_supported_for_provider` | Streaming was requested for the non-streaming Codex MVP. |
| `unsupported_parameter` | A Codex request used an unsupported message shape, field, or size. |
| `provider_overloaded` | Codex concurrency and queue capacity are both full. |
| `provider_unavailable` | Codex is enabled but its protected credential or runtime is unavailable. |
| `request_too_large` | The request exceeded the pre-parse transport limit active when Codex is enabled. |
| `model_not_allowed` | The requested model is outside the API key's allowlist. |
| `unsupported_response_format` | The selected compatibility profile cannot faithfully provide the requested response format. |
| `invalid_request` | The Chat Completions request does not satisfy the documented JSON contract. |
| `invalid_upstream_response` | A successful upstream response did not satisfy the guaranteed non-streaming contract. |
| `invalid_stream` | The upstream stream had an unsupported content type, event, chunk, order, or termination. |
| `request_cancelled` | The client cancelled the request and the gateway aborted the upstream request. |

**Health check (no auth):**
```bash
curl http://localhost:8080/health
```

**List models:**
```bash
curl http://localhost:8080/v1/models \
  -H "Authorization: Bearer sk-your-key"
```

**Chat completion:**
```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma4:26b-a4b-it-q4_K_M",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'
```

**Streaming:**
```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer sk-your-key" \
  -H "Content-Type: application/json" \
  -d '{"model": "gemma4:26b-a4b-it-q4_K_M", "messages": [{"role": "user", "content": "Count to 5"}], "stream": true}'
```

## Testing

Use Node 24 LTS for production-equivalent work; Node 22 is the supported compatibility lane. Install from the committed lockfile with `npm ci`.

```bash
npm test                    # run unit/integration tests once
npm run build               # TypeScript compile
npm run check:hygiene       # policy, secrets, syntax, whitespace
npm run check:quick         # hygiene + tests + build
npm run check:full          # quick + Docker build/runtime smoke
./scripts/install-hooks.sh  # enable committed pre-commit/pre-push gates
npm run test:watch          # watch mode
```

The Docker smoke expects the safe fixture backend to be disconnected and Codex to be disabled. It proves image startup, `/health`, and `/ui`, not a real Ollama/Apfel/Codex model call. Deterministic Codex tests use an injected fake runner and never contact OpenAI. See `docs/DEVELOPMENT_WORKFLOW.md` for proof boundaries and `.github/CI-CD-SETUP.md` for the pull-request workflow.

## Docker Commands

```bash
docker compose up -d        # start
docker compose down         # stop
docker compose logs -f      # follow logs
docker compose build        # rebuild after code changes
```
