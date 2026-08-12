# Open Keyboard Client Integration

## Shared semantic package

Semantic test cases are supplied by the pinned `Vendor/semantic-prompt-contract` Git submodule at
contract version `2.0.1`. The gateway serves its generated browser adapter to the admin playground;
it does not construct, prepend, alter, or own the production client's messages. The connectivity
smoke remains gateway-owned because it tests transport rather than semantic behavior.

Initialize the dependency with `git submodule update --init --recursive`. Upgrade by reviewing the
package changelog and equivalence fixtures, advancing the gitlink to an immutable contract commit,
and running `./scripts/check-semantic-prompt-contract.sh` plus the gateway full check. Never copy
canonical prompt wording into gateway TypeScript or HTML.

LLM Gateway is the backend companion for [Open Keyboard](../open-keyboard), an iOS AI keyboard that needs a user-controlled gateway for authentication, model routing, rate limits, and OpenAI-compatible chat completions.

## Contract used by Open Keyboard

Open Keyboard expects the gateway to expose:

```text
GET  /health
GET  /v1/models
POST /v1/chat/completions
```

Every gateway-generated non-2xx JSON API response uses the OpenAI nested error envelope `{ "error": { "message": "...", "type": "...", "code": "..." } }`. Open Keyboard should decode `error.message` for display, branch and localize using `error.code`, and tolerate unknown future codes without discarding the human-readable message.

Open Keyboard owns the semantic system/user prompts, operation-specific rules, JSON contract, and
assistant-content parsing. The gateway requires the standard `model` and `messages` fields, forwards
the client-provided message array unchanged, and never adds operation prompts or normalizes the
assistant content. Optional `operation` and `input_text` fields are additive metadata only.
Backend-supported structured requests can include `response_format: {"type":"json_object"}`.
Upstream non-2xx or an invalid outer Chat Completions envelope fails through the generic gateway
error contract. See [README.md](../README.md) for the gateway source of truth.

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

When the optional Codex alias is used, its text-only, non-streaming provider consumes the exact
client message conversation without adding Open Keyboard operation instructions. The Codex MVP
supports `response_format: {"type":"json_object"}` by validating that the returned content parses
as one JSON object; it does not add JSON instructions or support JSON Schema mode.
For compatibility with Open Keyboard's canonical request builder, the Codex route accepts
`temperature` and `max_tokens`; its CLI transport does not expose matching controls, so these two
fields do not alter Codex execution. Other unsupported generation fields are rejected.
The gateway key must explicitly list the Codex alias; a wildcard model grant alone is intentionally
insufficient.

## Development notes

Normal Open Keyboard CI uses offline mocks. Live gateway tests should remain opt-in through env vars such as:

```bash
OPEN_KEYBOARD_LIVE_GATEWAY_URL=http://localhost:8080 \
OPEN_KEYBOARD_LIVE_API_KEY=... \
OPEN_KEYBOARD_LIVE_MODEL=... \
swift test --package-path OpenKeyboardCore --filter LiveGatewayTests
```

Do not commit real keys, local config, or live logs. Fake-runner gateway tests and Docker smoke do not prove a live Codex inference path.
