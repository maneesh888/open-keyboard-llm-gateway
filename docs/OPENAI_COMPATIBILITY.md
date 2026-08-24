# OpenAI-compatible API contract

The stable client base URL is `https://host/v1` (or `http://localhost:8080/v1` for local development). Clients authenticate with `Authorization: Bearer <gateway-api-key>`.

The guaranteed compatibility surface is deliberately bounded to:

- `GET /v1/models`
- `POST /v1/chat/completions`

This is an independently selectable OpenAI-compatible backend. It is not a Universal AI Connector-specific protocol. Legacy OpenKeyboard `operation` and `input_text` fields are optional additive metadata and do not enable gateway-side prompt or response semantics.

## Compatibility matrix

| Capability | Level | Tested contract |
|---|---|---|
| Bearer API-key authentication | Supported | Missing, malformed, disabled, and invalid keys are rejected; credentials are not forwarded upstream. |
| Gateway-generated JSON errors | Supported | Always returns `{ "error": { "message", "type", "code" } }`; no custom negotiation header is required. |
| `GET /v1/models` | Supported | Returns `{ "object": "list", "data": [...] }`; each item has `id`, `object`, `created`, and `owned_by`; per-key model restrictions are applied. Codex appears with `owned_by: "codex"` only when ready and explicitly granted. |
| Non-streaming `POST /v1/chat/completions` | Supported | Validates `model` and `messages`. Ollama/Apfel preserve supported request values. Codex maps supported text messages to one isolated turn and wraps its final text in a valid response. |
| Streaming Chat Completions | Provider-dependent | Ollama/Apfel streaming requires validated `text/event-stream` chunks and terminal `[DONE]`. The Codex MVP rejects `stream: true` before execution. |
| Additive response fields | Supported | Valid OpenAI response objects are returned without a proprietary success envelope; unknown additive JSON fields are preserved. |
| Common generation fields | Provider-dependent | Ollama/Apfel pass through the documented fields after type validation. Codex accepts OpenKeyboard's `temperature` and `max_tokens` compatibility fields as no-ops and rejects the remaining generation controls. |
| Tools, multimodal message parts, `response_format`, `stream_options`, and other additive request fields | Partial/backend-dependent | Ollama/Apfel pass requests through subject to the response contract. Codex accepts text-only `system`, `developer`, `user`, and `assistant` messages plus `response_format.type: "json_object"`; it validates JSON-object output and rejects other response formats and unsupported fields. |
| Per-key reasoning effort | Ollama/Apfel custom default | Ollama/Apfel add configured effort only when the caller supplies none. Codex neither accepts caller effort nor applies the per-key default; its underlying model is deployment configuration. |
| Universal AI Connector profile | Explicit per-key fallback | Strips reasoning-only response fields while preserving visible text, usage, finish events, and one terminal `[DONE]`. JSON Schema requests are rejected before upstream execution. |
| OpenKeyboard `operation` + `input_text` | Additive metadata | Forwarded without interpretation for Ollama/Apfel and accepted but unused by Codex. Standard `model` and `messages` remain required. |
| `/v1/responses` | Experimental pass-through | Authenticated, rate-limited proxy behavior only. It is outside the guaranteed OpenAI Responses API contract and may depend entirely on the upstream backend. |
| Other `/v1/*` routes | Unsupported contract | They may be proxied for backward compatibility, but no OpenAI compatibility claim is made. |

## Request behavior

A standard Chat Completions body must be a JSON object with a non-empty string `model`, a `messages` array, and a boolean `stream` when `stream` is present. Each message needs a non-empty string `role` and string, `null`, or typed-array `content`; assistant tool-call messages may omit content when they contain `tool_calls` or `function_call`.

The gateway does not invent generation defaults or application prompts. Common generation parameters and unknown additive fields are passed through. The only gateway default is a per-key `reasoning_effort` configured by an administrator, and it is added only when the caller did not specify an effort setting. Invalid JSON, invalid standard field types, and disallowed models are rejected before an upstream call. Message order and content are not rebuilt.

The preceding pass-through statement applies to Ollama and Apfel. For the privileged Codex alias, the supported request fields are `model`, `messages`, optional `stream: false`, optional `response_format: {"type":"json_object"}`, optional OpenKeyboard `operation` plus `input_text`, and the OpenKeyboard compatibility fields `temperature` plus `max_tokens`. Messages must use `system`, `developer`, `user`, or `assistant` roles with string content. JSON-object mode validates the final content without adding instructions to the client conversation. The Codex CLI transport does not expose matching controls for `temperature` or `max_tokens`, so those two fields are accepted without changing execution. Codex rejects streaming, multimodal parts, tools, other response formats, unknown additive fields, and other Chat Completions generation parameters. The deployment-configured underlying Codex model is never taken from the client request.

Codex requests are bounded by configured input/output sizes, overall timeout, concurrency, and queue length. When Codex is enabled, a 1 MiB transport limit is applied to `/v1/chat/completions` before JSON materialization; because provider selection occurs inside that JSON, the transport cap also covers Ollama and Apfel requests on the endpoint. Client cancellation reaches the isolated turn. An authenticated admin Stop Codex action also aborts active/queued work and changes health to `stopped`; Start Codex resumes admission without inference. A timeout, cancellation, malformed/empty output, saturated queue, missing runtime/credential, stopped provider, or execution failure is normalized into the same safe error envelope without returning prompts, raw Codex events, stderr, paths, responses, or credentials.

For non-streaming standard requests, the upstream response must be JSON with `id`, `object: "chat.completion"`, `created`, `model`, and at least one choice containing `index`, `message.role`, and string `message.content`. Unknown additive fields remain intact.

For streaming requests, every data event must contain an OpenAI-style object with `object: "chat.completion.chunk"`, `id`, `created`, `model`, and `choices`. A usage-only chunk with empty `choices` is allowed when it contains `usage`. Individual SSE events are limited to 1,048,576 decoded characters. After validating one initial event, upstream reads advance only when the downstream client requests another event. The stream must end with `data: [DONE]`. An invalid first event is returned as HTTP 502. If a later event, transport failure, or termination is invalid after streaming has begun, the gateway emits a safe nested SSE error followed by `[DONE]` and aborts the upstream stream.

## Universal AI Connector profile

Set `compatibilityProfile: "universal-ai-connector"` on an individual API key only when its routed
backend produces additive reasoning fields that the connector's conservative text contract does
not accept. The profile is opt-in; keys without it preserve upstream additive fields unchanged.

For non-streaming completions, the profile removes `reasoning`, `reasoning_content`, and
`reasoning_details` only from each `choices[].message`. For streaming completions, it removes the
same fields from `choices[].delta`, omits events that contain no visible or control delta after
that removal, and preserves visible content, role events, usage-only events, finish reasons, and
exactly one terminal `[DONE]`. It does not copy reasoning into `content`, alter usage, change the
configured reasoning effort, or suppress reasoning for other keys.

The profile rejects `response_format.type: "json_schema"` with HTTP 400 and code
`unsupported_response_format` before an upstream request. Stripping reasoning cannot make a
backend enforce a schema, and increasing the output-token budget is not proof of schema support.
Route connector keys to a non-reasoning model/provider with real JSON Schema enforcement whenever
structured output is required; use this profile only as the explicitly bounded fallback.

Enable it through the admin API, for example:

```bash
curl -X PATCH "$ADMIN_BASE_URL/admin/keys/$KEY_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"compatibilityProfile":"universal-ai-connector"}'
```

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

Codex-specific safe codes are `stream_not_supported_for_provider`, `unsupported_parameter`, `provider_overloaded`, `provider_unavailable`, and `request_too_large`; `unsupported_response_format` identifies a compatibility-profile request that cannot be fulfilled faithfully. Common `upstream_timeout`, `request_cancelled`, `upstream_error`, and `invalid_upstream_response` codes are reused where appropriate.

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
