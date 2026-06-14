import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { OllamaProxy } from '../src/proxy/ollama.js';

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists upstream Ollama models for unrestricted keys without a configured default', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'gemma4:latest' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'gemma4:latest' }] }), {
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
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:11434/api/tags',
      'http://localhost:11434/api/ps',
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
      new Response(JSON.stringify({ choices: [] }), {
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
  });

  it('streams SSE responses through without buffering', async () => {
    const sseBody = 'data: {"content":"hello"}\n\ndata: [DONE]\n\n';
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
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
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
      new Response('{"choices":[]}', { status: 200, headers: { 'content-type': 'application/json' } }),
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
  });

  it('adds Apfel models to the admin model list when Apfel is reachable', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'apple-foundationmodel' }] }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const proxy = new OllamaProxy('http://localhost:11434', 'http://localhost:11435');

    await expect(proxy.listModels()).resolves.toContain('apple-foundationmodel');
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
