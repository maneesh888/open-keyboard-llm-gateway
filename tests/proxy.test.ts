import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'fs';
import { Hono } from 'hono';
import { OllamaProxy } from '../src/proxy/ollama.js';

// OllamaProxy's default knownModelsPath is relative to cwd; keep tests isolated from real disk state.
const KNOWN_MODELS_PATH = './config/known-models.json';

function chatCompletion(content = 'Hello', extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: 'gemma4',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    ...extra,
  });
}

// Helper: build a minimal app that injects an API key into context and uses the proxy
function buildApp(proxy: OllamaProxy, keyOverrides: Record<string, unknown> = {}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('apiKey', {
      id: 'k1',
      name: 'Test',
      key: 'sk-test',
      enabled: true,
      allowedModels: ['*'],
      createdAt: '2026-01-01',
      ...keyOverrides,
    });
    await next();
  });
  app.all('/v1/*', (c) => proxy.forward(c));
  return app;
}

describe('OllamaProxy', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    rmSync(KNOWN_MODELS_PATH, { force: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(KNOWN_MODELS_PATH, { force: true });
  });

  it('lists upstream Ollama models for unrestricted keys without a configured default', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'gemma4:latest' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/models');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      object: 'list',
      data: [{ id: 'gemma4:latest', object: 'model', created: 0, owned_by: 'ollama' }],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:11434/api/tags',
    ]);
  });

  it('returns the key configured Apfel model for public model discovery', async () => {
    const proxy = new OllamaProxy('http://localhost:11434', 'http://localhost:11435');
    const app = buildApp(proxy, {
      modelConfig: { model: 'apple-foundationmodel', maxTokens: 100, temperature: 0.7 },
    });
    const res = await app.request('/v1/models');

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      object: 'list',
      data: [{ id: 'apple-foundationmodel', object: 'model', created: 0, owned_by: 'apfel' }],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns restricted allowed models for public model discovery', async () => {
    const proxy = new OllamaProxy('http://localhost:11434', 'http://localhost:11435');
    const app = buildApp(proxy, {
      allowedModels: ['apple-foundationmodel', 'gemma4:latest'],
    });
    const res = await app.request('/v1/models');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((model: { id: string }) => model.id)).toEqual(['apple-foundationmodel', 'gemma4:latest']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards POST request body to Ollama', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(chatCompletion(), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const payload = JSON.stringify({ model: 'gemma4', messages: [{ role: 'user', content: 'hi' }] });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });

    expect(res.status).toBe(200);
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(opts.method).toBe('POST');
    expect(opts.body).toBe(payload);
  });

  it('preserves standard generation fields and unknown additive request values exactly', async () => {
    const upstreamBody = JSON.parse(chatCompletion('Preserved'));
    upstreamBody.system_fingerprint = 'fp_test';
    upstreamBody.gateway_unknown = { retained: true };
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(upstreamBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const payload = {
      model: 'gemma4',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0,
      top_p: 0.75,
      n: 1,
      max_tokens: 0,
      max_completion_tokens: 64,
      presence_penalty: -0.5,
      frequency_penalty: 0.25,
      seed: 0,
      stop: ['END'],
      stream: false,
      response_format: { type: 'json_object' },
      vendor_extension: { enabled: false },
    };

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(opts.body))).toEqual(payload);
    expect(await res.json()).toEqual(upstreamBody);
  });

  it.each([
    ['malformed JSON', '{'],
    ['a missing model', JSON.stringify({ messages: [] })],
    ['missing messages', JSON.stringify({ model: 'gemma4' })],
    ['a non-boolean stream', JSON.stringify({ model: 'gemma4', messages: [], stream: 'true' })],
    ['a non-numeric generation field', JSON.stringify({ model: 'gemma4', messages: [], temperature: '0.2' })],
    ['an invalid message', JSON.stringify({ model: 'gemma4', messages: [{ content: 'hi' }] })],
  ])('rejects %s before calling upstream', async (_label, requestBody) => {
    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String), code: 'invalid_request' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects non-JSON content types and non-POST Chat Completions calls', async () => {
    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const wrongType = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ model: 'gemma4', messages: [] }),
    });
    const wrongMethod = await app.request('/v1/chat/completions');

    expect(wrongType.status).toBe(415);
    expect(wrongMethod.status).toBe(405);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('adds configured effort to chat completion requests when caller leaves it unset', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(chatCompletion(), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy, {
      modelConfig: { model: 'gemma4', maxTokens: 100, temperature: 0.7, effort: 'low' },
    });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(res.status).toBe(200);
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(opts.body))).toMatchObject({ reasoning_effort: 'low' });
  });

  it('adds configured effort to responses requests under reasoning', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ output: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy, {
      modelConfig: { model: 'gemma4', maxTokens: 100, temperature: 0.7, effort: 'medium' },
    });

    const res = await app.request('/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', input: 'hi', reasoning: { summary: 'auto' } }),
    });

    expect(res.status).toBe(200);
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(opts.body))).toMatchObject({ reasoning: { summary: 'auto', effort: 'medium' } });
  });

  it('preserves caller-provided effort settings over key defaults', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(chatCompletion(), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy, {
      modelConfig: { model: 'gemma4', maxTokens: 100, temperature: 0.7, effort: 'low' },
    });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [], reasoning_effort: 'high' }),
    });

    expect(res.status).toBe(200);
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(opts.body))).toMatchObject({ reasoning_effort: 'high' });
  });

  it('does not forward Authorization header to Ollama', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = new Hono();
    // Include an auth header in this test to verify it gets stripped
    app.use('*', async (c, next) => {
      c.set('apiKey', { id: 'k1', name: 'Test', key: 'sk-secret', enabled: true, createdAt: '2026-01-01' });
      await next();
    });
    app.all('/v1/*', (c) => proxy.forward(c));

    await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer sk-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [] }),
    });

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Headers;
    expect(headers.get('authorization')).toBeNull();
  });

  it('returns 503 when Ollama is unreachable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/models');

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/not reachable/i);
    expect(body.code).toBe('upstream_unreachable');
  });

  it('normalizes upstream non-2xx responses into the gateway error envelope', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'raw upstream error', code: 'raw_code' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [] }),
    });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: 'Upstream model request failed.',
      code: 'upstream_error',
      upstreamStatus: 500,
    });
  });

  it('returns 504 on timeout', async () => {
    const timeoutError = new Error('The operation was aborted');
    timeoutError.name = 'TimeoutError';
    fetchSpy.mockRejectedValueOnce(timeoutError);

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [] }),
    });

    expect(res.status).toBe(504);
    await expect(res.json()).resolves.toMatchObject({ error: expect.any(String), code: 'upstream_timeout' });
  });

  it('streams SSE responses through without buffering', async () => {
    const sseBody = [
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gemma4","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gemma4","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":"stop"}]}',
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gemma4","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    fetchSpy.mockResolvedValueOnce(
      new Response(sseBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [], stream: true }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(await res.text()).toBe(sseBody);
  });

  it('rejects a malformed first SSE event with a safe HTTP error', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('data: {"content":"not-an-openai-chunk"}\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [], stream: true }),
    });

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: 'The upstream emitted an invalid Chat Completions stream.',
      code: 'invalid_stream',
    });
  });

  it('turns a malformed later SSE event into a nested stream error and [DONE]', async () => {
    const first = 'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gemma4","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}\n\n';
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(first));
      },
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('data: not-json\n\n'));
        controller.close();
      },
    });
    fetchSpy.mockResolvedValueOnce(new Response(upstream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [], stream: true }),
    });

    expect(res.status).toBe(200);
    const streamed = await res.text();
    expect(streamed.startsWith(first)).toBe(true);
    expect(streamed).toContain('"type":"server_error"');
    expect(streamed).toContain('"code":"invalid_stream"');
    expect(streamed.endsWith('data: [DONE]\n\n')).toBe(true);
  });

  it('treats [DONE] as terminal without waiting for upstream EOF', async () => {
    const complete = [
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gemma4","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":"stop"}]}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    let upstreamCancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(complete));
      },
      cancel() {
        upstreamCancelled = true;
      },
    });
    fetchSpy.mockResolvedValueOnce(new Response(upstream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [], stream: true }),
    });

    expect(await res.text()).toBe(complete);
    expect(upstreamCancelled).toBe(true);
  });

  it('turns a stream missing [DONE] into a safe terminal error event', async () => {
    const first = 'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gemma4","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}\n\n';
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(first));
        controller.close();
      },
    });
    fetchSpy.mockResolvedValueOnce(new Response(upstream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [], stream: true }),
    });

    expect(res.status).toBe(200);
    const streamed = await res.text();
    expect(streamed.startsWith(first)).toBe(true);
    expect(streamed).toContain('"code":"invalid_stream"');
    expect(streamed.endsWith('data: [DONE]\n\n')).toBe(true);
  });

  it('rejects unsupported streaming content types', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"message":{"content":"hello"}}\n', {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    }));

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [], stream: true }),
    });

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'invalid_stream' });
  });

  it('aborts the upstream stream when the downstream client cancels', async () => {
    const first = 'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gemma4","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}\n\n';
    let upstreamSignal: AbortSignal | undefined;
    let upstreamCancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(first));
      },
      cancel() {
        upstreamCancelled = true;
      },
    });
    fetchSpy.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      upstreamSignal = init.signal as AbortSignal;
      return new Response(upstream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [], stream: true }),
    });
    await res.body?.cancel('client disconnected');

    expect(upstreamSignal?.aborted).toBe(true);
    expect(upstreamCancelled).toBe(true);
  });

  it('propagates request aborts to an in-flight upstream fetch', async () => {
    let upstreamSignal: AbortSignal | undefined;
    fetchSpy.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      upstreamSignal = init.signal as AbortSignal;
      return await new Promise<Response>((_resolve, reject) => {
        upstreamSignal?.addEventListener('abort', () => reject(upstreamSignal?.reason), { once: true });
      });
    });

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const client = new AbortController();
    const pending = app.request(new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [] }),
      signal: client.signal,
    }));
    await vi.waitFor(() => expect(upstreamSignal).toBeDefined());
    client.abort('client disconnected');
    const res = await pending;

    expect(upstreamSignal?.aborted).toBe(true);
    expect(res.status).toBe(408);
    expect(await res.json()).toMatchObject({ code: 'request_cancelled' });
  });

  it('rejects malformed successful non-streaming responses without exposing their body', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"private_internal_detail":"do not expose"}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [] }),
    });
    const responseBody = await res.text();

    expect(res.status).toBe(502);
    expect(JSON.parse(responseBody)).toMatchObject({ code: 'invalid_upstream_response' });
    expect(responseBody).not.toContain('private_internal_detail');
    expect(responseBody).not.toContain('do not expose');
  });

  it('returns 403 when model is not in allowedModels', async () => {
    // No fetch call expected — gate should reject before proxying
    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy, { allowedModels: ['gemma4'] });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4', messages: [] }),
    });

    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows request when model matches allowedModels', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(chatCompletion(), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy, { allowedModels: ['gemma4'] });

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [] }),
    });

    expect(res.status).toBe(200);
  });

  it('routes apple-foundationmodel chat completions to Apfel when configured', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(chatCompletion(undefined, { model: 'apple-foundationmodel' }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const proxy = new OllamaProxy('http://localhost:11434', 'http://localhost:11435');
    const app = buildApp(proxy);

    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'apple-foundationmodel', messages: [] }),
    });

    expect(res.status).toBe(200);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11435/v1/chat/completions');
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Headers).get('authorization')).toBeNull();
  });

  it('adds Apfel models to the admin model list when Apfel is reachable', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'apple-foundationmodel' }] }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const proxy = new OllamaProxy('http://localhost:11434', 'http://localhost:11435');

    await expect(proxy.listModels()).resolves.toContain('apple-foundationmodel');
  });



  it('adds operation schema instructions and bounded input text for OpenKeyboard operation requests', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"operation":"fix_grammar","results":[]}' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy, {
      modelConfig: { model: 'gemma4', maxTokens: 100, temperature: 0.7, effort: 'low' },
    });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemma4',
        operation: 'fix_grammar',
        input_text: 'i has a apple',
        messages: [{ role: 'user', content: 'Fix grammar' }],
        stream: false,
      }),
    });

    expect(res.status).toBe(200);
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const forwarded = JSON.parse(String(opts.body));
    expect(forwarded.operation).toBe('fix_grammar');
    expect(forwarded.reasoning_effort).toBe('low');
    expect(forwarded.input_text).toBe('i has a apple');
    expect(forwarded.messages[0].role).toBe('system');
    expect(forwarded.messages[0].content).toContain('results');
    expect(forwarded.messages[0].content).toContain('category');
    expect(forwarded.messages.at(-1).content).toContain('<<<i has a apple>>>');
  });

  it('normalizes structured OpenKeyboard operation responses inside OpenAI chat wrapper', async () => {
    const structured = {
      operation: 'fix_grammar',
      results: [
        { id: 'grammar-1', type: 'correction', title: 'Article', text: 'Use an before apple', original: 'a apple', replacement: 'an apple', range: { start: 6, end: 13 }, confidence: 0.94, extra: 'ignored' },
        { id: 'spelling-1', type: 'correction', title: 'Spelling', text: 'Fix typo', original: 'ths', replacement: 'this' },
      ],
      summary: 'Found two issues.',
      corrected_text: 'i has an apple, this is nt sound god',
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(structured) } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', operation: 'fix_grammar', input_text: 'i has a apple,ths is nt sound god', messages: [], stream: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const content = JSON.parse(body.choices[0].message.content);
    expect(content.operation).toBe('fix_grammar');
    expect(content.results).toHaveLength(2);
    expect(content.results[0]).toMatchObject({ type: 'correction', replacement: 'an apple', range: { start: 6, end: 13 } });
    expect(content.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Article', original: 'a apple', replacement: 'an apple' }),
      expect.objectContaining({ title: 'Spelling', original: 'ths', replacement: 'this' }),
    ]));
    expect(content.corrected_text).toBe('i has an apple, this is nt sound god');
    expect(content).not.toHaveProperty('error');
    expect(content).not.toHaveProperty('code');
    expect(content).not.toHaveProperty('degraded');
    expect(content).not.toHaveProperty('degraded_reason');
  });

  it('normalizes complex OpenKeyboard spell-fix responses matching the keyboard mock contract', async () => {
    const inputText = 'i definately recieve teh adress tomorow, and seperate files wont upload because its recieve limit is to low.';
    const correctedText = "I definitely receive the address tomorrow, and separate files won't upload because their receive limit is too low.";
    const structured = {
      operation: 'fix_grammar',
      results: [
        { id: 'cap-i', type: 'correction', title: 'Capitalization', text: 'Capitalize the pronoun.', original: 'i', replacement: 'I', range: { start: 0, end: 1 }, confidence: 0.99, category: 'capitalization', explanation: 'Capitalize the standalone pronoun I.' },
        { id: 'spell-definitely', type: 'correction', title: 'Spelling', text: 'Correct definitely.', original: 'definately', replacement: 'definitely', range: { start: 2, end: 12 }, confidence: 0.99, category: 'spelling', explanation: 'Correct the misspelling.' },
        { id: 'spell-receive-1', type: 'correction', title: 'Spelling', text: 'Correct receive.', original: 'recieve', replacement: 'receive', range: { start: 13, end: 20 }, confidence: 0.98, category: 'spelling', explanation: 'Use receive after c.' },
        { id: 'spell-the', type: 'correction', title: 'Spelling', text: 'Correct the.', original: 'teh', replacement: 'the', range: { start: 21, end: 24 }, confidence: 0.97, category: 'spelling' },
        { id: 'spell-address', type: 'correction', title: 'Spelling', text: 'Correct address.', original: 'adress', replacement: 'address', range: { start: 25, end: 31 }, confidence: 0.98, category: 'spelling' },
        { id: 'spell-tomorrow', type: 'correction', title: 'Spelling', text: 'Correct tomorrow.', original: 'tomorow', replacement: 'tomorrow', range: { start: 32, end: 39 }, confidence: 0.97, category: 'spelling' },
        { id: 'spell-separate', type: 'correction', title: 'Spelling', text: 'Correct separate.', original: 'seperate', replacement: 'separate', range: { start: 45, end: 53 }, confidence: 0.95, category: 'spelling' },
        { id: 'contract-wont', type: 'correction', title: 'Contraction', text: 'Add apostrophe.', original: 'wont', replacement: "won't", range: { start: 60, end: 64 }, confidence: 0.93, category: 'grammar' },
        { id: 'pronoun-its', type: 'correction', title: 'Pronoun agreement', text: 'Use a plural possessive pronoun.', original: 'its', replacement: 'their', range: { start: 80, end: 83 }, confidence: 0.88, category: 'grammar', explanation: 'Files is plural.' },
        { id: 'spell-receive-2', type: 'correction', title: 'Spelling', text: 'Correct the second receive.', original: 'recieve', replacement: 'receive', range: { start: 84, end: 91 }, confidence: 0.98, category: 'spelling' },
        { id: 'too-low', type: 'correction', title: 'Word choice', text: 'Use too for degree.', original: 'to low', replacement: 'too low', range: { start: 101, end: 107 }, confidence: 0.94, category: 'grammar' },
        { id: 'warning-domain', type: 'warning', title: 'Ambiguity', text: 'The phrase receive limit may be domain-specific.' },
      ],
      summary: 'Eleven corrections found.',
      corrected_text: correctedText,
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(structured) } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', operation: 'fix_grammar', input_text: inputText, messages: [], stream: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const content = JSON.parse(body.choices[0].message.content);
    expect(content.operation).toBe('fix_grammar');
    expect(content.results).toHaveLength(12);
    expect(content.results.filter((item: { type: string }) => item.type === 'correction').map((item: { replacement: string }) => item.replacement)).toEqual([
      'I',
      'definitely',
      'receive',
      'the',
      'address',
      'tomorrow',
      'separate',
      "won't",
      'their',
      'receive',
      'too low',
    ]);
    expect(content.results[0]).toMatchObject({ id: 'cap-i', category: 'capitalization', range: { start: 0, end: 1 } });
    expect(content.results[9]).toMatchObject({ id: 'spell-receive-2', replacement: 'receive', range: { start: 84, end: 91 }, category: 'spelling' });
    expect(content.results[11]).toMatchObject({ id: 'warning-domain', type: 'warning', title: 'Ambiguity' });
    expect(content.summary).toBe('Eleven corrections found.');
    expect(content.corrected_text).toBe(correctedText);

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const forwarded = JSON.parse(String(opts.body));
    expect(forwarded.messages[0].content).toContain('one correction item per distinct issue');
    expect(forwarded.messages.at(-1).content).toContain(inputText);
  });

  it('normalizes real oss-120g complex spell-fix playground responses', async () => {
    const inputText = 'i definately recieve teh adress tomorow, and seperate files wont upload because its recieve limit is to low.';
    const correctedText = "I definitely receive the address tomorrow, and separate files won't upload because its receive limit is too low.";
    const structured = {
      operation: 'fix_grammar',
      results: [
        { id: '1', type: 'correction', title: 'Capitalization', text: "Capitalize the pronoun 'i' to 'I'.", original: 'i', replacement: 'I', range: { start: 0, end: 1 }, confidence: 0.99, explanation: 'The first-person singular pronoun should always be capitalized.', category: 'Capitalization' },
        { id: '2', type: 'correction', title: 'Spelling', text: "Correct the misspelled word 'definately' to 'definitely'.", original: 'definately', replacement: 'definitely', range: { start: 2, end: 12 }, confidence: 0.99, explanation: "The correct spelling is 'definitely'.", category: 'Spelling' },
        { id: '3', type: 'correction', title: 'Spelling', text: "Replace 'recieve' with the correct spelling 'receive'.", original: 'recieve', replacement: 'receive', range: { start: 13, end: 20 }, confidence: 0.99, explanation: "'Receive' is the proper spelling.", category: 'Spelling' },
        { id: '4', type: 'correction', title: 'Spelling', text: "Correct the transposition error 'teh' to 'the'.", original: 'teh', replacement: 'the', range: { start: 21, end: 24 }, confidence: 0.99, explanation: "The definite article is spelled 'the'.", category: 'Spelling' },
        { id: '5', type: 'correction', title: 'Spelling', text: "Change 'adress' to 'address'.", original: 'adress', replacement: 'address', range: { start: 25, end: 31 }, confidence: 0.99, explanation: "'Address' requires a double 'd'.", category: 'Spelling' },
        { id: '6', type: 'correction', title: 'Spelling', text: "Replace 'tomorow' with 'tomorrow'.", original: 'tomorow', replacement: 'tomorrow', range: { start: 32, end: 39 }, confidence: 0.99, explanation: "'Tomorrow' is the correct spelling.", category: 'Spelling' },
        { id: '7', type: 'correction', title: 'Spelling', text: "Correct 'seperate' to 'separate'.", original: 'seperate', replacement: 'separate', range: { start: 45, end: 53 }, confidence: 0.99, explanation: "'Separate' is the proper spelling.", category: 'Spelling' },
        { id: '8', type: 'correction', title: 'Punctuation', text: 'Add an apostrophe to form the contraction "won\'t".', original: 'wont', replacement: "won't", range: { start: 60, end: 64 }, confidence: 0.99, explanation: 'The contracted form of "will not" requires an apostrophe.', category: 'Punctuation' },
        { id: '9', type: 'correction', title: 'Spelling', text: "Replace the second occurrence of 'recieve' with 'receive'.", original: 'recieve', replacement: 'receive', range: { start: 84, end: 91 }, confidence: 0.99, explanation: "'Receive' is the correct spelling.", category: 'Spelling' },
        { id: '10', type: 'correction', title: 'Word choice', text: "Change 'to' to 'too' to express the correct degree.", original: 'to', replacement: 'too', range: { start: 101, end: 103 }, confidence: 0.99, explanation: "'Too' (with double o) means 'excessively' whereas 'to' is a preposition.", category: 'Grammar' },
      ],
      summary: 'All spelling, capitalization, punctuation, and word-choice errors were identified and corrected.',
      corrected_text: correctedText,
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(structured) } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'oss-120g', operation: 'fix_grammar', input_text: inputText, messages: [], stream: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const content = JSON.parse(body.choices[0].message.content);
    expect(content.operation).toBe('fix_grammar');
    expect(content.results).toHaveLength(10);
    expect(content.results.map((item: { replacement: string }) => item.replacement)).toEqual([
      'I',
      'definitely',
      'receive',
      'the',
      'address',
      'tomorrow',
      'separate',
      "won't",
      'receive',
      'too',
    ]);
    expect(content.results[0]).toMatchObject({ id: '1', category: 'Capitalization', range: { start: 0, end: 1 } });
    expect(content.results[8]).toMatchObject({ id: '9', original: 'recieve', replacement: 'receive', range: { start: 84, end: 91 }, category: 'Spelling' });
    expect(content.results[9]).toMatchObject({ id: '10', original: 'to', replacement: 'too', range: { start: 101, end: 103 }, category: 'Grammar' });
    expect(content.results).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ original: 'its', replacement: 'their' }),
    ]));
    expect(content.summary).toContain('spelling');
    expect(content.corrected_text).toBe(correctedText);

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const forwarded = JSON.parse(String(opts.body));
    expect(forwarded.messages[0].content).toContain('one correction item per distinct issue');
    expect(forwarded.messages.at(-1).content).toContain(inputText);
  });


  it('rejects streaming structured operation requests before upstream calls', async () => {
    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', operation: 'fix_grammar', input_text: 'hello', messages: [], stream: true }),
    });

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({
      error: 'stream must be false when operation is provided',
      code: 'stream_not_supported_for_operation',
    });
  });

  it('does not validate or mutate operation-shaped payloads on non-chat proxy endpoints', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const original = { model: 'gemma4', operation: 'delete_everything', input_text: '', messages: [] };
    const res = await app.request('/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(original),
    });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual(original);
  });

  it('keeps clean grammar input as no-issue when upstream returns an explicit empty structured result', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ operation: 'fix_grammar', results: [], corrected_text: 'The app works well today.' }) } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', operation: 'fix_grammar', input_text: 'The app works well today.', messages: [], stream: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const content = JSON.parse(body.choices[0].message.content);
    expect(content).toEqual({ operation: 'fix_grammar', results: [], corrected_text: 'The app works well today.' });
  });


  it('wraps legacy plain model text for OpenKeyboard migration compatibility', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: 'I have an apple.' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', operation: 'fix_grammar', input_text: 'i has a apple', messages: [], stream: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const content = JSON.parse(body.choices[0].message.content);
    expect(content).toMatchObject({ operation: 'fix_grammar', corrected_text: 'I have an apple.' });
    expect(content.results[0]).toMatchObject({
      type: 'correction',
      original: 'i has a apple',
      replacement: 'I have an apple.',
    });
  });

  it('rejects unsupported OpenKeyboard operations before upstream calls', async () => {
    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', operation: 'delete_everything', input_text: 'hello', messages: [] }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Unsupported operation 'delete_everything'",
      code: 'unsupported_operation',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });



  it.each([
    {
      name: 'items alias',
      operation: 'fix_grammar',
      inputText: 'teh quik borwn fox',
      upstreamContent: JSON.stringify({ operation: 'fix_grammar', items: [{ id: 'spelling-1', type: 'correction', title: 'Spelling', text: 'Fix teh', original: 'teh', replacement: 'the' }], corrected_text: 'the quick brown fox' }),
      expected: { type: 'correction', replacement: 'the', display: 'the quick brown fox' },
    },
    {
      name: 'markdown fenced JSON',
      operation: 'fix_grammar',
      inputText: 'teh quik borwn fox',
      upstreamContent: '```json\n{"operation":"fix_grammar","results":[{"id":"spelling-1","type":"correction","title":"Spelling","text":"Fix typo","original":"teh","replacement":"the"}],"corrected_text":"the quick brown fox"}\n```',
      expected: { type: 'correction', replacement: 'the', display: 'the quick brown fox' },
    },
    {
      name: 'summary operation',
      operation: 'summarize',
      inputText: 'The keyboard supports private AI. It can fix grammar and summarize text.',
      upstreamContent: JSON.stringify({ operation: 'summarize', results: [{ id: 'summary-1', type: 'summary', title: 'Summary', text: 'The keyboard offers private AI writing help.' }], summary: 'The keyboard offers private AI writing help.' }),
      expected: { type: 'summary', text: 'The keyboard offers private AI writing help.', summary: 'The keyboard offers private AI writing help.' },
    },
    {
      name: 'rewrite operation',
      operation: 'rewrite',
      inputText: 'this sounds bad and confusing',
      upstreamContent: JSON.stringify({ operation: 'rewrite', results: [{ id: 'rewrite-1', type: 'suggestion', title: 'Clearer rewrite', text: 'This could be clearer and easier to read.', replacement: 'This could be clearer and easier to read.' }] }),
      expected: { type: 'suggestion', replacement: 'This could be clearer and easier to read.' },
    },
  ])('normalizes structured operation scenario: $name', async ({ operation, inputText, upstreamContent, expected }) => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: upstreamContent } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', operation, input_text: inputText, messages: [], stream: false }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const content = JSON.parse(body.choices[0].message.content);
    expect(content.operation).toBe(operation);
    const { display, summary, ...expectedItem } = expected as Record<string, unknown>;
    expect(content.results[0]).toMatchObject(expectedItem);
    if (display) expect(content.corrected_text).toBe(display);
    if (summary) expect(content.summary).toBe(summary);
  });

  it('preserves explicitly empty structured responses instead of wrapping them as legacy text', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"operation":"fix_grammar","results":[]}' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', operation: 'fix_grammar', input_text: 'i has a apple', messages: [] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const content = JSON.parse(body.choices[0].message.content);
    expect(content).toEqual({ operation: 'fix_grammar', results: [] });
    expect(body).not.toHaveProperty('error');
    expect(body).not.toHaveProperty('code');
    expect(content).not.toHaveProperty('degraded');
    expect(content).not.toHaveProperty('degraded_reason');
  });

  it('turns malformed JSON-like operation output into a safe warning result', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"operation":"fix_grammar","results":[' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', operation: 'fix_grammar', input_text: 'i has a apple', messages: [] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const content = JSON.parse(body.choices[0].message.content);
    expect(content).toEqual({
      operation: 'fix_grammar',
      results: [expect.objectContaining({ id: 'invalid-structured-response', type: 'warning' })],
    });
    expect(content.results[0].text).not.toContain('{"operation":"fix_grammar","results":[');
  });

  it('turns valid JSON with the wrong operation schema into a safe warning result', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"message":"Done"}' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', operation: 'summarize', input_text: 'Summarize this.', messages: [] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const content = JSON.parse(body.choices[0].message.content);
    expect(content).toMatchObject({
      operation: 'summarize',
      results: [expect.objectContaining({ id: 'invalid-structured-response', type: 'warning' })],
    });
  });

  it('rejects an invalid outer OpenAI-compatible response envelope', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('{"choices":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', operation: 'summarize', input_text: 'Summarize this.', messages: [] }),
    });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: 'Upstream model request failed.',
      code: 'upstream_error',
    });
  });

  it('rejects blank input_text when operation is provided before upstream calls', async () => {
    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', operation: 'fix_grammar', input_text: '   ', messages: [] }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'input_text is required when operation is provided',
      code: 'input_text_required',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('bounds long input_text before upstream prompt shaping', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: '{"operation":"summarize","results":[]}' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const longInput = 'a'.repeat(2100);
    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', operation: 'summarize', input_text: longInput, messages: [] }),
    });

    expect(res.status).toBe(200);
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const forwarded = JSON.parse(String(opts.body));
    expect(forwarded.input_text).toHaveLength(2000);
    expect(forwarded.messages.at(-1).content).toContain('<<<' + 'a'.repeat(2000) + '>>>');
    expect(forwarded.messages.at(-1).content).not.toContain('a'.repeat(2001));
  });

  it('health check returns true when Ollama responds 200', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const proxy = new OllamaProxy('http://localhost:11434');
    expect(await proxy.healthCheck()).toBe(true);
  });

  it('health check returns false when Ollama is down', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const proxy = new OllamaProxy('http://localhost:11434');
    expect(await proxy.healthCheck()).toBe(false);
  });
});
