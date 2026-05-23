import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { KeyManager } from '../../src/keys/manager.js';
import { AdminAuth } from '../../src/admin/auth.js';
import { createAdminRoutes } from '../../src/admin/keyRoutes.js';
import type { AdminConfig } from '../../src/types/index.js';

function buildAdminApp() {
  const dir = join(tmpdir(), 'llm-gateway-admin-routes-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  mkdirSync(dir, { recursive: true });
  const keysPath = join(dir, 'keys.json');
  writeFileSync(keysPath, JSON.stringify({
    keys: [
      {
        id: 'key_existing',
        name: 'Existing Key',
        key: 'sk-existing-secret-value',
        enabled: true,
        rateLimitConfig: { requestsPerMinute: 30, burstAllowance: 10 },
        features: { suggestions: true, customActions: [] },
        modelConfig: { model: 'gemma4:latest', maxTokens: 100, temperature: 0.7 },
        owner: 'owner@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }));

  const adminConfig: AdminConfig = {
    users: [
      {
        username: 'admin',
        // bcrypt hash for "admin"
        passwordHash: '$2b$10$fhnp5VTHZgJgWEYJHtp3juIuCcQYhpl3JStwRMH55vwdJzxekkOn.',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    jwtSecret: 'test-admin-secret',
    sessionExpiryHours: 24,
  };

  const keyManager = new KeyManager(keysPath);
  const adminAuth = new AdminAuth(adminConfig);
  const app = new Hono();
  app.route('/admin', createAdminRoutes(keyManager, adminAuth));
  const token = adminAuth.generateToken('admin');

  return { app, token };
}

describe('Admin key routes', () => {
  let app: Hono;
  let token: string;

  beforeEach(() => {
    ({ app, token } = buildAdminApp());
  });

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  it('rejects requests without admin token', async () => {
    const res = await app.request('/admin/keys');
    expect(res.status).toBe(401);
  });

  it('lists keys with sanitized key values', async () => {
    const res = await app.request('/admin/keys', { headers: authHeaders() });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].name).toBe('Existing Key');
    expect(body.keys[0].key).toBe('sk-existin...');
    expect(body.keys[0].key).not.toBe('sk-existing-secret-value');
  });

  it('returns one full key by id', async () => {
    const res = await app.request('/admin/keys/key_existing', { headers: authHeaders() });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe('key_existing');
    expect(body.key).toBe('sk-existing-secret-value');
  });

  it('creates a key with default feature/model/rate settings', async () => {
    const res = await app.request('/admin/keys', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Created From Test', owner: 'test@example.com' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^key_/);
    expect(body.key).toMatch(/^sk-/);
    expect(body.name).toBe('Created From Test');
    expect(body.enabled).toBe(true);
    expect(body.rateLimitConfig.requestsPerMinute).toBe(30);
    expect(body.modelConfig.model).toBe('gemma4:latest');
  });

  it('rejects create without name', async () => {
    const res = await app.request('/admin/keys', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ owner: 'test@example.com' }),
    });

    expect(res.status).toBe(400);
  });

  it('updates mutable fields but never overwrites id or key value', async () => {
    const res = await app.request('/admin/keys/key_existing', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'hacked',
        key: 'sk-hacked',
        name: 'Renamed',
        enabled: false,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('key_existing');
    expect(body.key).toBe('sk-existing-secret-value');
    expect(body.name).toBe('Renamed');
    expect(body.enabled).toBe(false);
  });

  it('deletes a key', async () => {
    const del = await app.request('/admin/keys/key_existing', {
      method: 'DELETE',
      headers: authHeaders(),
    });
    expect(del.status).toBe(200);

    const get = await app.request('/admin/keys/key_existing', { headers: authHeaders() });
    expect(get.status).toBe(404);
  });

  it('returns 404 for missing key update/delete/get', async () => {
    const get = await app.request('/admin/keys/missing', { headers: authHeaders() });
    expect(get.status).toBe(404);

    const patch = await app.request('/admin/keys/missing', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(patch.status).toBe(404);

    const del = await app.request('/admin/keys/missing', {
      method: 'DELETE',
      headers: authHeaders(),
    });
    expect(del.status).toBe(404);
  });
});
