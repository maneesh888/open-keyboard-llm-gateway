import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { KeyManager } from '../src/keys/manager.js';
import { authMiddleware } from '../src/middleware/auth.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Auth Middleware', () => {
  let app: Hono;
  let keysPath: string;

  beforeAll(() => {
    const dir = join(tmpdir(), 'llm-gateway-test-' + Date.now());
    mkdirSync(dir, { recursive: true });
    keysPath = join(dir, 'keys.json');
    writeFileSync(keysPath, JSON.stringify({
      keys: [
        { id: 'k1', name: 'Test', key: 'sk-test-valid', enabled: true, createdAt: '2026-01-01' },
        { id: 'k2', name: 'Disabled', key: 'sk-test-disabled', enabled: false, createdAt: '2026-01-01' },
      ]
    }));

    const km = new KeyManager(keysPath);
    app = new Hono();
    app.use('*', authMiddleware(km));
    app.get('/test', (c) => c.json({ ok: true }));
  });

  it('passes with valid key', async () => {
    const res = await app.request('/test', { headers: { Authorization: 'Bearer sk-test-valid' } });
    expect(res.status).toBe(200);
  });

  it('rejects missing header', async () => {
    const res = await app.request('/test');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Missing Authorization header', code: 'missing_authorization' });
  });

  it('rejects invalid key', async () => {
    const res = await app.request('/test', { headers: { Authorization: 'Bearer sk-wrong' } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid or disabled API key', code: 'invalid_api_key' });
  });

  it('rejects disabled key', async () => {
    const res = await app.request('/test', { headers: { Authorization: 'Bearer sk-test-disabled' } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid or disabled API key', code: 'invalid_api_key' });
  });

  it('rejects malformed auth header', async () => {
    const res = await app.request('/test', { headers: { Authorization: 'Basic abc123' } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'Invalid Authorization format. Use: Bearer sk-xxx',
      code: 'invalid_authorization_format',
    });
  });

  it('supports the nested OpenAI error envelope without changing the legacy default', async () => {
    const res = await app.request('/test', {
      headers: { 'X-Gateway-Error-Format': 'openai' },
    });

    expect(res.status).toBe(401);
    expect(res.headers.get('x-gateway-error-formats')).toBe('legacy, openai');
    expect(await res.json()).toEqual({
      error: {
        message: 'Missing Authorization header',
        type: 'authentication_error',
        code: 'missing_authorization',
      },
    });
  });
});
