# Open Keyboard Client Integration

LLM Gateway is the backend companion for [Open Keyboard](../open-keyboard), an iOS AI keyboard that needs a user-controlled gateway for authentication, model routing, rate limits, and OpenAI-compatible chat completions.

## Contract used by Open Keyboard

Open Keyboard expects the gateway to expose:

```text
GET  /health
GET  /v1/models
POST /v1/chat/completions
```

Every gateway-generated non-2xx JSON API response uses the OpenAI nested error envelope `{ "error": { "message": "...", "type": "...", "code": "..." } }`. Open Keyboard should decode `error.message` for display, branch and localize using `error.code`, and tolerate unknown future codes without discarding the human-readable message.

Structured results that satisfy the requested contract remain HTTP 200, including explicit empty `results` arrays. For deployed-client compatibility, plain model text is normalized into the established structured result and malformed JSON-like output becomes a safe warning result rather than exposing raw model output. Upstream non-2xx or an invalid outer response envelope uses `upstream_error`. See the error-code table and Open Keyboard integration section in [README.md](../README.md) for the gateway source of truth.

Authentication:

```http
Authorization: Bearer <gateway-api-key>
```

Open Keyboard currently uses these requests for:

- connection testing
- model list discovery
- grammar fixing
- rewriting
- summarization
- translation
- continuation prompts

## Local pairing flow

1. Run LLM Gateway locally or on a host reachable by the iPhone/simulator.
2. Create an API key in the LLM Gateway admin UI/API.
3. Enter the gateway URL and API key in Open Keyboard settings.
4. Open Keyboard validates the key via `/health`, `/v1/models`, and a small chat completion.
5. Keyboard actions send selected/context text to the configured gateway only after user setup.

## Privacy expectations

- Open Keyboard should clearly disclose that network calls require iOS keyboard **Full Access**.
- Selected/typed text is sent only to the user-configured gateway.
- Gateway logs should not include Authorization headers, API keys, or full private user text.
- Public fixtures/docs must avoid real private text.

## Development notes

Normal Open Keyboard CI uses offline mocks. Live gateway tests should remain opt-in through env vars such as:

```bash
OPEN_KEYBOARD_LIVE_GATEWAY_URL=http://localhost:8080 \
OPEN_KEYBOARD_LIVE_API_KEY=... \
OPEN_KEYBOARD_LIVE_MODEL=... \
swift test --package-path OpenKeyboardCore --filter LiveGatewayTests
```

Do not commit real keys, local config, or live logs.
