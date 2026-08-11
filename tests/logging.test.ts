import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { loggingMiddleware } from '../src/logging/logger.js';

describe('request logging privacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs metadata without Authorization or request-body contents', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value?: unknown) => logs.push(String(value)));
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('apiKey', { id: 'key-safe-id', name: 'Safe key name' });
      c.set('model', 'gemma4');
      await next();
    });
    app.use('*', loggingMiddleware());
    app.post('/v1/chat/completions', (c) => c.json({ ok: true }));

    const secret = 'fixture-sensitive-gateway-credential';
    const sensitiveBody = 'private keyboard text that must not be logged';
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'gemma4', messages: [{ role: 'user', content: sensitiveBody }] }),
    });

    expect(res.status).toBe(200);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('key-safe-id');
    expect(logs[0]).toContain('gemma4');
    expect(logs[0]).not.toContain(secret);
    expect(logs[0]).not.toContain(sensitiveBody);
    expect(logs[0]).not.toContain('authorization');
    expect(logs[0]).not.toContain('messages');
  });
});
