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
| `GET /v1/models` | Supported | Returns `{ "object": "list", "data": [...] }`; each item has `id`, `object`, `created`, and `owned_by`; per-key model restrictions are applied. Codex appears with `owned_by: "codex"` only when ready and explicitly granted. |
| Non-streaming `POST /v1/chat/completions` | Supported | Validates `model` and `messages`. Ollama/Apfel preserve supported request values. Codex maps supported text messages to one isolated turn and wraps its final text in a valid response. |
| Streaming Chat Completions | Provider-dependent | Ollama/Apfel streaming requires validated `text/event-stream` chunks and terminal `[DONE]`. The Codex MVP rejects `stream: true` before execution. |
| Additive response fields | Supported | Valid OpenAI response objects are returned without a proprietary success envelope; unknown additive JSON fields are preserved. |
| Common generation fields | Provider-dependent | Ollama/Apfel pass through the documented fields after type validation. Codex rejects them because the fixed provider contract cannot faithfully honor those Chat Completions controls. |
| Tools, multimodal message parts, `response_format`, `stream_options`, and other additive request fields | Partial/backend-dependent | Ollama/Apfel pass requests through subject to the response contract. Codex accepts text-only `system`, `developer`, `user`, and `assistant` messages and rejects unsupported fields. |
| Per-key reasoning effort | Ollama/Apfel custom default | Ollama/Apfel add configured effort only when the caller supplies none. Codex neither accepts caller effort nor applies the per-key default; its underlying model is deployment configuration. |
| OpenKeyboard `operation` + `input_text` | Custom extension | Optional structured-operation mode across Ollama, Apfel, and Codex. `input_text` is required when `operation` is present, and `stream: true` is rejected. |
| `/v1/responses` | Experimental pass-through | Authenticated, rate-limited proxy behavior only. It is outside the guaranteed OpenAI Responses API contract and may depend entirely on the upstream backend. |
| Other `/v1/*` routes | Unsupported contract | They may be proxied for backward compatibility, but no OpenAI compatibility claim is made. |

## Request behavior

A standard Chat Completions body must be a JSON object with a non-empty string `model`, a `messages` array, and a boolean `stream` when `stream` is present. Each message needs a non-empty string `role` and string, `null`, or typed-array `content`; assistant tool-call messages may omit content when they contain `tool_calls` or `function_call`.

The gateway does not invent generation defaults. Common generation parameters and unknown additive fields are passed through. The only gateway default is a per-key `reasoning_effort` configured by an administrator, and it is added only when the caller did not specify an effort setting. Invalid JSON, invalid standard field types, unsupported OpenKeyboard operations, blank operation input, disallowed models, and streaming operation requests are rejected before an upstream call.

The preceding pass-through statement applies to Ollama and Apfel. For the privileged Codex alias, the supported request fields are `model`, `messages`, optional `stream: false`, and optional OpenKeyboard `operation` plus `input_text`. Messages must use `system`, `developer`, `user`, or `assistant` roles with string content. Codex rejects streaming, multimodal parts, tools, response formats, unknown additive fields, and Chat Completions generation parameters instead of silently ignoring them. The deployment-configured underlying Codex model is never taken from the client request.

Codex requests are bounded by configured input/output sizes, overall timeout, concurrency, and queue length. When Codex is enabled, a 1 MiB transport limit is applied to `/v1/chat/completions` before JSON materialization; because provider selection occurs inside that JSON, the transport cap also covers Ollama and Apfel requests on the endpoint. Client cancellation reaches the isolated turn. A timeout, cancellation, malformed/empty output, saturated queue, missing runtime/credential, or execution failure is normalized into the same safe error envelope without returning prompts, raw Codex events, stderr, paths, responses, or credentials.

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

Codex-specific safe codes are `stream_not_supported_for_provider`, `unsupported_parameter`, `provider_overloaded`, `provider_unavailable`, and `request_too_large`; common `upstream_timeout`, `request_cancelled`, `upstream_error`, and `invalid_upstream_response` codes are reused where appropriate.

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

Codex non-streaming completion (only for a key whose allowlist explicitly contains the alias):

```bash
curl "$BASE_URL/chat/completions" \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"codex","messages":[{"role":"user","content":"Reply in one short sentence."}],"stream":false}'
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

Ollama and Apfel model IDs are exact backend routing identifiers and must be sent back unchanged. `owned_by: "ollama"` means the ID is served through the configured Ollama backend; `owned_by: "apfel"` identifies the configured Apfel route. `owned_by: "codex"` identifies the stable public alias for a separately configured underlying Codex model. Ownership labels describe routing only and do not assert tool, vision, context-window, or other model capabilities.

Codex is a privileged exception to wildcard authorization. A key must contain the exact public alias in `allowedModels`; `"*"` alone does not authorize or discover it. This provider is for private/trusted-user deployments only.
