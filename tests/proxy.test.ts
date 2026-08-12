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

function chatCompletionChunk(content: string) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1_700_000_000,
    model: 'gemma4',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  })}\n\n`;
}

function gatewayError(message: string, type: string, code: string, extra: Record<string, unknown> = {}) {
  return { ...extra, error: { message, type, code } };
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
    upstreamBody.choices[0].message.reasoning = 'sanitized fixture reasoning';
    upstreamBody.choices[0].message.reasoning_content = { retained: true };
    upstreamBody.choices[0].message.reasoning_details = ['retained'];
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

  it('strips reasoning fields from non-streaming messages only for opted-in connector keys', async () => {
    const upstreamBody = JSON.parse(chatCompletion('ready', {
      usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
      system_fingerprint: 'fp_test',
    }));
    upstreamBody.choices[0].message.reasoning = 'sanitized fixture reasoning';
    upstreamBody.choices[0].message.reasoning_content = { private: 'fixture' };
    upstreamBody.choices[0].message.reasoning_details = ['fixture'];
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify(upstreamBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy, { compatibilityProfile: 'universal-ai-connector' });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gemma4', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.choices[0].message).toEqual({ role: 'assistant', content: 'ready' });
    expect(body.choices[0].finish_reason).toBe('stop');
    expect(body.usage).toEqual({ prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 });
    expect(body.system_fingerprint).toBe('fp_test');
    expect(JSON.stringify(body)).not.toContain('reasoning');
  });

  it('rejects JSON Schema requests for connector-profile keys before calling upstream', async () => {
    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy, { compatibilityProfile: 'universal-ai-connector' });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-oss:120b-cloud',
        messages: [{ role: 'user', content: 'Return JSON.' }],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'answer',
            strict: true,
            schema: { type: 'object' },
          },
        },
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(gatewayError(
      'JSON Schema structured output is not supported by this compatibility profile.',
      'invalid_request_error',
      'unsupported_response_format',
    ));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps JSON Schema pass-through unchanged for default keys', async () => {
    const upstreamBody = chatCompletion('{"answer":"ready"}');
    fetchSpy.mockResolvedValueOnce(new Response(upstreamBody, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const payload = {
      model: 'schema-capable-model',
      messages: [{ role: 'user', content: 'Return JSON.' }],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'answer', strict: true, schema: { type: 'object' } },
      },
    };

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1].body))).toEqual(payload);
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
    expect(await res.json()).toMatchObject({
      error: {
        message: expect.any(String),
        type: 'invalid_request_error',
        code: 'invalid_request',
      },
    });
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
    expect(body.error.message).toMatch(/not reachable/i);
    expect(body.error.type).toBe('server_error');
    expect(body.error.code).toBe('upstream_unreachable');
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
    await expect(res.json()).resolves.toEqual(gatewayError(
      'Upstream model request failed.',
      'server_error',
      'upstream_error',
      {
        upstreamStatus: 500,
      },
    ));
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
    await expect(res.json()).resolves.toMatchObject({
      error: {
        message: expect.any(String),
        type: 'server_error',
        code: 'upstream_timeout',
      },
    });
  });

  it('streams SSE responses through without buffering', async () => {
    const sseBody = [
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gemma4","choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning":"fixture"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gemma4","choices":[{"index":0,"delta":{"content":"hello","reasoning_content":"fixture","reasoning_details":["fixture"]},"finish_reason":"stop"}]}',
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

  it('omits reasoning-only events and sanitizes visible connector-profile SSE events', async () => {
    const sseBody = [
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gpt-oss","choices":[{"index":0,"delta":{"role":"assistant","content":"","reasoning":"fixture"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gpt-oss","choices":[{"index":0,"delta":{"content":"","reasoning":"fixture","reasoning_content":"fixture","reasoning_details":["fixture"]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gpt-oss","choices":[{"index":0,"delta":{"content":"ready","reasoning":"fixture"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gpt-oss","choices":[{"index":0,"delta":{"content":"","reasoning":"fixture"},"finish_reason":"stop"}]}',
      'data: {"id":"chatcmpl-test","object":"chat.completion.chunk","created":1700000000,"model":"gpt-oss","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":5,"total_tokens":9}}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    fetchSpy.mockResolvedValueOnce(new Response(sseBody, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }));

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy, { compatibilityProfile: 'universal-ai-connector' });
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-oss', messages: [], stream: true }),
    });

    expect(res.status).toBe(200);
    const streamed = await res.text();
    expect(streamed).not.toContain('reasoning');
    expect(streamed.match(/data: \[DONE\]/g)).toHaveLength(1);
    const events = streamed.trim().split('\n\n');
    expect(events).toHaveLength(5);
    const chunks = events
      .filter((event) => event !== 'data: [DONE]')
      .map((event) => JSON.parse(event.slice('data: '.length)));
    expect(chunks[0].choices[0].delta).toEqual({ role: 'assistant', content: '' });
    expect(chunks[1].choices[0].delta).toEqual({ content: 'ready' });
    expect(chunks[2].choices[0]).toMatchObject({
      delta: { content: '' },
      finish_reason: 'stop',
    });
    expect(chunks[3]).toMatchObject({
      choices: [],
      usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
    });
  });

  it('reads upstream SSE only when the downstream consumer requests another event', async () => {
    const textEncoder = new TextEncoder();
    const textDecoder = new TextDecoder();
    let upstreamPullCount = 0;
    let upstreamCancelled = false;
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        upstreamPullCount += 1;
        controller.enqueue(textEncoder.encode(chatCompletionChunk(`chunk-${upstreamPullCount}`)));
      },
      cancel() {
        upstreamCancelled = true;
      },
    }, { highWaterMark: 0 });
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
    expect(upstreamPullCount).toBe(1);
    await Promise.resolve();
    expect(upstreamPullCount).toBe(1);

    const downstream = res.body?.getReader();
    expect(downstream).toBeDefined();
    const first = await downstream!.read();
    expect(textDecoder.decode(first.value)).toContain('chunk-1');
    expect(upstreamPullCount).toBe(1);

    const second = await downstream!.read();
    expect(textDecoder.decode(second.value)).toContain('chunk-2');
    expect(upstreamPullCount).toBe(2);
    await Promise.resolve();
    expect(upstreamPullCount).toBe(2);

    await downstream!.cancel('slow client disconnected');
    expect(upstreamCancelled).toBe(true);
  });

  it('rejects an oversized incomplete first SSE event', async () => {
    const oversizedEvent = `data: ${'x'.repeat(1024 * 1024)}`;
    fetchSpy.mockResolvedValueOnce(new Response(oversizedEvent, {
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
    expect(await res.json()).toEqual(gatewayError(
      'The upstream emitted an invalid Chat Completions stream.',
      'server_error',
      'invalid_stream',
    ));
  });

  it('terminates an oversized incomplete later SSE event without exposing it', async () => {
    const textEncoder = new TextEncoder();
    const first = chatCompletionChunk('hello');
    const oversizedEvent = `data: ${'x'.repeat(1024 * 1024)}`;
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(textEncoder.encode(first));
      },
      pull(controller) {
        controller.enqueue(textEncoder.encode(oversizedEvent));
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
    expect(streamed).not.toContain('x'.repeat(64));
    expect(streamed.endsWith('data: [DONE]\n\n')).toBe(true);
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
    expect(await res.json()).toEqual(gatewayError(
      'The upstream emitted an invalid Chat Completions stream.',
      'server_error',
      'invalid_stream',
    ));
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

  it('turns a late upstream read failure into a safe stream error and [DONE]', async () => {
    const first = chatCompletionChunk('hello');
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(first));
      },
      pull() {
        throw new Error('private upstream transport detail');
      },
    }, { highWaterMark: 0 });
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
    expect(streamed).not.toContain('private upstream transport detail');
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
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_stream' } });
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
    expect(await res.json()).toMatchObject({ error: { code: 'request_cancelled' } });
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
    expect(JSON.parse(responseBody)).toMatchObject({ error: { code: 'invalid_upstream_response' } });
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



  it('forwards client-owned messages and structured-output fields unchanged', async () => {
    const assistantContent = '{"operation":"fix_grammar","results":[';
    const upstreamBody = chatCompletion(assistantContent, { vendor_response: { retained: true } });
    fetchSpy.mockResolvedValueOnce(new Response(upstreamBody, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const payload = {
      model: 'gemma4',
      operation: 'fix_grammar',
      input_text: 'i has a apple',
      messages: [
        { role: 'system', content: 'Client-owned system instruction.' },
        { role: 'developer', content: 'Keep this message in this position.' },
        { role: 'user', content: 'Client-owned operation prompt.' },
      ],
      response_format: { type: 'json_object' },
      stream: false,
    };
    const requestBody = JSON.stringify(payload);
    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: requestBody,
    });

    expect(res.status).toBe(200);
    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(opts.body).toBe(requestBody);
    const forwarded = JSON.parse(String(opts.body));
    expect(forwarded.messages).toEqual(payload.messages);
    expect(forwarded.response_format).toEqual({ type: 'json_object' });
    expect(await res.text()).toBe(upstreamBody);
  });

  it.each([
    ['model', { operation: 'fix_grammar', input_text: 'text', messages: [] }],
    ['messages', { model: 'gemma4', operation: 'fix_grammar', input_text: 'text' }],
  ])('requires the standard %s field even when operation metadata is present', async (_field, payload) => {
    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_request');
    expect(fetchSpy).not.toHaveBeenCalled();
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
