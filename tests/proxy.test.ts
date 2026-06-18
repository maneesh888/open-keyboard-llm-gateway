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



  it('adds operation schema instructions and bounded input text for OpenKeyboard operation requests', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: 'Corrected text.' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const proxy = new OllamaProxy('http://localhost:11434');
    const app = buildApp(proxy);
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
    expect(forwarded.input_text).toBe('i has a apple');
    expect(forwarded.messages[0].role).toBe('system');
    expect(forwarded.messages[0].content).toContain('results');
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
    expect(await res.json()).toEqual({ error: 'stream must be false when operation is provided' });
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


  it('wraps legacy corrected text into a structured operation result for migration compatibility', async () => {
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
    expect(content.results[0]).toMatchObject({ type: 'correction', original: 'i has a apple', replacement: 'I have an apple.' });
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
    expect(await res.json()).toEqual({ error: "Unsupported operation 'delete_everything'" });
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
  });

  it('does not wrap malformed JSON-like operation output as corrected text', async () => {
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
    expect(content.results[0].replacement).toBeUndefined();
    expect(content.corrected_text).toBeUndefined();
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
    expect(await res.json()).toEqual({ error: 'input_text is required when operation is provided' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('bounds long input_text before upstream prompt shaping', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: 'Done.' } }] }), {
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
