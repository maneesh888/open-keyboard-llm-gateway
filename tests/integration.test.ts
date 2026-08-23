import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createApp } from '../src/server.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Integration', () => {
  let app: ReturnType<typeof createApp>['app'];

  beforeAll(() => {
    const dir = join(tmpdir(), 'llm-gateway-int-' + Date.now());
    mkdirSync(dir, { recursive: true });
    const keysPath = join(dir, 'keys.json');
    writeFileSync(
      keysPath,
      JSON.stringify({
        keys: [
          {
            id: 'k1',
            name: 'Test',
            key: 'sk-int-test',
            enabled: true,
            allowedModels: ['*'],
            createdAt: '2026-01-01',
          },
          {
            id: 'k2',
            name: 'Restricted',
            key: 'sk-restricted',
            enabled: true,
            allowedModels: ['gemma4'],
            createdAt: '2026-01-01',
          },
        ],
      }),
    );
    ({ app } = createApp(
      { port: 0, ollamaHost: 'http://localhost:99999', logLevel: 'error', corsOrigins: ['*'] },
      keysPath,
    ));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('health check returns { status: "ok" } without auth', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.ollama).toBe('disconnected');
    expect(body.codex).toBe('disabled');
  });

  it('serves the pinned semantic prompt browser adapter without auth', async () => {
    const res = await app.request('/ui/semantic-prompt-contract.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(await res.text()).toContain('SemanticPromptContractBrowser');
  });

  it('serves the Admin Playground selection logic without auth', async () => {
    const res = await app.request('/ui/playground.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(await res.text()).toContain('AdminPlaygroundLogic');
  });

  it('rejects unauthenticated /v1/ requests with 401', async () => {
    const res = await app.request('/v1/models');
    expect(res.status).toBe(401);
  });

  it('rejects disabled / missing key', async () => {
    const res = await app.request('/v1/models', {
      headers: { Authorization: 'Bearer sk-does-not-exist' },
    });
    expect(res.status).toBe(401);
  });

  it('authenticated request returns 503 when Ollama is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );
    const res = await app.request('/v1/models', {
      headers: { Authorization: 'Bearer sk-int-test' },
    });
    expect(res.status).toBe(503);
  });

  it('returns 403 when key does not allow the requested model', async () => {
    // No fetch needed — gate fires before proxying
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer sk-restricted',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'gpt-4', messages: [] }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await app.request('/not-a-route');
    expect(res.status).toBe(404);
  });

  it('CORS header is present on responses', async () => {
    const res = await app.request('/health', {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });
});
