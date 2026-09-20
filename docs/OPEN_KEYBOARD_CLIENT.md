# Open Keyboard Client Integration

## Shared semantic package

Semantic test cases are supplied by the pinned `Vendor/semantic-prompt-contract` Git submodule at
contract version `3.1.1`. The gateway serves its generated browser adapter to the admin playground;
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

## Development notes

Normal Open Keyboard CI uses offline mocks. Live gateway tests should remain opt-in through env vars such as:

```bash
OPEN_KEYBOARD_LIVE_GATEWAY_URL=http://localhost:8080 \
OPEN_KEYBOARD_LIVE_API_KEY=... \
OPEN_KEYBOARD_LIVE_MODEL=... \
swift test --package-path OpenKeyboardCore --filter LiveGatewayTests
```

Do not commit real keys, local config, or live logs. Deterministic gateway tests and Docker smoke do not prove a live model inference path.

## Exact-model verification diagnosis (September 2026)

The profileless response path previously accepted the upstream model field unchanged. The
September 11 cloud identity correction (`6e87ae7`) only applied to keys that opted into the
legacy Universal AI Connector reasoning profile. Current connectors accept additive reasoning
metadata, so an ordinary key could still receive a cloud-routing marker omitted from the response
model even though the outbound request used the exact configured identity. Identity validation and
the documented single terminal cloud-marker restoration now apply independently of that profile.
No client messages, model selection, token budgets, or reasoning defaults are changed.

Sanitized live observations from the configured profiles, using canonical package diagnostics:

| Profile / operation | Deployed content length | Corrected content length | Deployed → corrected model match |
| --- | --- | --- | --- |
| Low grammar | 42 | 42 | true → true |
| Low rewrite | 548 | 548 | true → true |
| Low translation | 1001 | 985 | true → true |
| High grammar | 39 | 42 | false → true |
| High rewrite | 690 | 688 | false → true |
| High translation | 553 | 710 | false → true |

Every sampled row returned HTTP 200, one assistant choice, string content, and `finish_reason:
stop`; both authenticated catalogs contained the requested model. High-profile reasoning lengths
were 1537/2596/2403 before and 1604/1644/3231 afterward. These were separate inference calls, so
length differences do not imply response-text rewriting. The corrected gateway was an owned
isolated process with the existing model, effort and quota settings and ephemeral authentication.
These observations prove outer response structure, not semantic correctness or the client's full
exact-head differential. No prompts, response text, credentials, URLs, or exact model IDs are retained.

A separate upstream probe with a 32-token cap returned one assistant choice, blank string content,
nonblank reasoning (length 128), and `finish_reason: length`. The old validator accepted that shape;
the corrected validator returns a sanitized HTTP 502 `invalid_upstream_response`. It does not turn
reasoning into final content, expand caller token budgets, retry inference, or label truncation
`stop`. This rejection alone cannot make an undersized request produce a usable answer.

### Quota correction at deployment

The low key's observed quota was 30 requests/minute with burst 10; the high key's was 60/minute
with burst 20. Authenticated catalog and completion calls share each key's token bucket. In a
bounded 14-call catalog probe (concurrency 4), the low key returned three HTTP 429 responses with
remaining capacity zero and `Retry-After: 2`. No inference was needed to reproduce the failure.
The limiter's consumption policy predates the recent proxy changes. Upstream HTTP 429 is handled
separately as HTTP 502 `upstream_error` with `upstreamStatus: 429` and no raw upstream body.

Do not deploy an unlimited retry or globally disable quota enforcement to make a verification
sequence pass. At the separately authorized deployment, adjust only the existing low key's
`rateLimitConfig` to cover the intended bounded workload. A concrete starting setting is
`requestsPerMinute: 60, burstAllowance: 30`; regression coverage proves a 14-request mixed sequence
fits that setting after refill. This is not evidence that an arbitrary longer or concurrent run
fits. Size the quota against the complete client sequence and concurrent iPhone use, allow the
bucket to refill, and retain the existing credentials, URLs, model identities and environment names.
No deployed configuration was changed by this source correction.

After deploying the gateway and applying the intended verification quota, rerun OpenKeyboard's
`./scripts/check-live.sh gateway-differential` on its required exact head. Both profiles must pass
exact-model transport and the canonical grammar, rewrite, and translation diagnostics without 429,
substitution, fallback, or `invalidResponse`. The configured low profile is intentionally not
required to satisfy the long-translation capability boundary: unusable upstream output there must
fail closed as the sanitized `invalid_upstream_response`, while the high profile must complete that
boundary. OpenKeyboard owns translating that low-profile rejection into its capability-warning UX;
that client classification does not block this gateway correction. A successful gateway fixture or
structural probe cannot replace the deployed diagnostic evidence.
