# LLM Gateway

A lightweight API gateway that authenticates API keys and proxies requests to a local Ollama instance.

> Companion backend for [Open Keyboard](../open-keyboard): the iOS keyboard uses this gateway for API-key auth, model discovery, rate limiting, and OpenAI-compatible chat completions while keeping infrastructure under user control.

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
│  │  Ollama Proxy │  │  forward request
│  └───────────────┘  │
└─────────────────────┘
        │
        ▼
┌─────────────────────┐
│      Ollama         │  :11434
│  gemma4:26b-a4b...  │
└─────────────────────┘
```

## Setup

### 1. Configure keys

```bash
cp config/keys.example.json config/keys.json
# Edit config/keys.json and set your own sk- tokens
```

### 2. Configure server

```bash
cp config/config.example.json config/config.json
# Edit OLLAMA_HOST if needed (default: http://host.docker.internal:11434)
```

### 3. Run locally

```bash
npm install
npm run dev
```

### 4. Run with Docker

```bash
docker compose build
docker compose up -d
docker compose logs -f
```

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

## Admin API (New!)

The gateway now includes an admin API for managing API keys programmatically.

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

### 2. Admin API Endpoints

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

### 3. Per-Client Configuration

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
- `temperature`: Response creativity (0.0-1.0)

## Open Keyboard integration

LLM Gateway is designed to pair with Open Keyboard as its self-hosted backend:

- `GET /health` for connection checks.
- `GET /v1/models` for model discovery.
- `POST /v1/chat/completions` for grammar, rewrite, summarize, translate, and continuation actions.
- Bearer API keys created through the gateway admin UI/API.

More detail:

```text
docs/OPEN_KEYBOARD_CLIENT.md
```

## API Usage

The gateway proxies all `/v1/*` routes to Ollama. Use it as an OpenAI-compatible endpoint.

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

```bash
npm test          # run once
npm run test:watch  # watch mode
```

## Docker Commands

```bash
docker compose up -d        # start
docker compose down         # stop
docker compose logs -f      # follow logs
docker compose build        # rebuild after code changes
```
