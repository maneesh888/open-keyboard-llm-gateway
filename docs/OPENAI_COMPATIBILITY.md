# OpenAI-compatible API contract

The stable client base URL is `https://host/v1` (or `http://localhost:8080/v1` for local development). Clients authenticate with `Authorization: Bearer <gateway-api-key>`.

The guaranteed compatibility surface is deliberately bounded to:

- `GET /v1/models`
- `POST /v1/chat/completions`

This is an independently selectable OpenAI-compatible backend. It is not a Universal AI Connector-specific protocol. The OpenKeyboard `operation` and `input_text` fields are optional extensions and are never required for standard Chat Completions requests.

## Compatibility matrix

| Capability | Level | Tested contract |
|---|---|---|
| Bearer API-key authentication | Supported | Missing, malformed, disabled, and invalid keys are rejected; credentials are not forwarded upstream. |
| Gateway-generated JSON errors | Supported | Always returns `{ "error": { "message", "type", "code" } }`; no custom negotiation header is required. |
| `GET /v1/models` | Supported | Returns `{ "object": "list", "data": [...] }`; each item has `id`, `object`, `created`, and `owned_by`; per-key model restrictions are applied. |
| Non-streaming `POST /v1/chat/completions` | Supported | Validates `model`, `messages`, and common generation-field types; preserves the request values; requires an OpenAI text response with `choices[].message.content`. |
| Streaming Chat Completions | Supported | Requires `text/event-stream`, validates `chat.completion.chunk` events, preserves event order, requires terminal `[DONE]`, and propagates downstream cancellation upstream. |
| Additive response fields | Supported | Valid OpenAI response objects are returned without a proprietary success envelope; unknown additive JSON fields are preserved. |
| Common generation fields | Pass-through | `temperature`, `top_p`, `n`, `max_tokens`, `max_completion_tokens`, `presence_penalty`, `frequency_penalty`, `seed`, `stop`, and `top_logprobs` are forwarded with caller values unchanged after basic JSON type validation. |
| Tools, multimodal message parts, `response_format`, `stream_options`, and other additive request fields | Partial/backend-dependent | Requests are passed through, but the guaranteed response contract is text content. Tool-call-only responses are outside the tested contract and may be rejected; the gateway does not emulate backend capabilities. |
| Per-key reasoning effort | Custom default | When configured and the caller supplies no effort field, the gateway adds `reasoning_effort`; caller-provided values always win. |
| OpenKeyboard `operation` + `input_text` | Custom extension | Optional structured-operation mode. `input_text` is required when `operation` is present, and `stream: true` is rejected. Standard requests are not rewritten by this mode. |
| `/v1/responses` | Experimental pass-through | Authenticated, rate-limited proxy behavior only. It is outside the guaranteed OpenAI Responses API contract and may depend entirely on the upstream backend. |
| Other `/v1/*` routes | Unsupported contract | They may be proxied for backward compatibility, but no OpenAI compatibility claim is made. |

## Request behavior

A standard Chat Completions body must be a JSON object with a non-empty string `model`, a `messages` array, and a boolean `stream` when `stream` is present. Each message needs a non-empty string `role` and string, `null`, or typed-array `content`; assistant tool-call messages may omit content when they contain `tool_calls` or `function_call`.

The gateway does not invent generation defaults. Common generation parameters and unknown additive fields are passed through. The only gateway default is a per-key `reasoning_effort` configured by an administrator, and it is added only when the caller did not specify an effort setting. Invalid JSON, invalid standard field types, unsupported OpenKeyboard operations, blank operation input, disallowed models, and streaming operation requests are rejected before an upstream call.

For non-streaming standard requests, the upstream response must be JSON with `id`, `object: "chat.completion"`, `created`, `model`, and at least one choice containing `index`, `message.role`, and string `message.content`. Unknown additive fields remain intact.

For streaming requests, every data event must contain an OpenAI-style object with `object: "chat.completion.chunk"`, `id`, `created`, `model`, and `choices`. A usage-only chunk with empty `choices` is allowed when it contains `usage`. Individual SSE events are limited to 1,048,576 decoded characters. After validating one initial event, upstream reads advance only when the downstream client requests another event. The stream must end with `data: [DONE]`. An invalid first event is returned as HTTP 502. If a later event, transport failure, or termination is invalid after streaming has begun, the gateway emits a safe nested SSE error followed by `[DONE]` and aborts the upstream stream.

## Errors

Every gateway-generated JSON error uses the OpenAI nested error shape without content negotiation or a gateway-specific request header:

```json
{
  "error": {
    "message": "Missing Authorization header",
    "type": "authentication_error",
    "code": "missing_authorization"
  }
}
```

Streaming protocol failures also use a nested error event because an HTTP error can no longer be substituted after response streaming has started. Error messages never contain raw upstream bodies, credentials, or configured upstream URLs.

## Copy-paste examples

Set values once:

```bash
BASE_URL=http://localhost:8080/v1
GATEWAY_API_KEY=replace-with-your-gateway-key
MODEL=gemma4:latest
```

List models:

```bash
curl "$BASE_URL/models" \
  -H "Authorization: Bearer $GATEWAY_API_KEY"
```

Non-streaming completion:

```bash
curl "$BASE_URL/chat/completions" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in five words.\"}],\"temperature\":0.2,\"stream\":false}"
```

Streaming completion:

```bash
curl -N "$BASE_URL/chat/completions" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Count to three.\"}],\"stream\":true}"
```

Authentication failure:

```bash
curl "$BASE_URL/models"
```

Rate limiting (repeat until HTTP 429; the key's configured limit determines when):

```bash
curl -i "$BASE_URL/models" \
  -H "Authorization: Bearer $GATEWAY_API_KEY"
```

Rate-limited responses include `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers plus the configured error envelope.

## Model semantics

Model IDs are exact backend routing identifiers and must be sent back unchanged. `owned_by: "ollama"` means the ID is served through the configured Ollama backend; `owned_by: "apfel"` identifies the configured Apfel route. Ownership labels describe routing only and do not assert tool, vision, context-window, or other model capabilities.
