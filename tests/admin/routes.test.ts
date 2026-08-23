import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { KeyManager } from '../../src/keys/manager.js';
import { AdminAuth } from '../../src/admin/auth.js';
import { createAdminRoutes } from '../../src/admin/keyRoutes.js';
import type { AdminConfig } from '../../src/types/index.js';
import type { ModelRuntimeManager, ModelRuntimeStatus } from '../../src/models/runtime.js';

function buildAdminApp(modelRuntime?: ModelRuntimeManager) {
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
  app.route('/admin', createAdminRoutes(keyManager, adminAuth, undefined, modelRuntime));
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
    await expect(res.json()).resolves.toEqual({
      error: {
        message: 'Unauthorized',
        type: 'authentication_error',
        code: 'admin_unauthorized',
      },
    });
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
    expect(body.modelConfig.effort).toBeUndefined();
    expect(body.allowedModels).toEqual(['*']);
  });

  it('creates a key with optional model effort setting', async () => {
    const res = await app.request('/admin/keys', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Effort Key',
        modelConfig: { model: 'local-model', maxTokens: 250, temperature: 0.2, effort: 'low' },
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.modelConfig).toEqual({ model: 'local-model', maxTokens: 250, temperature: 0.2, effort: 'low' });
  });

  it('creates a key with the Universal AI Connector compatibility profile', async () => {
    const res = await app.request('/admin/keys', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Connector Key',
        compatibilityProfile: 'universal-ai-connector',
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.compatibilityProfile).toBe('universal-ai-connector');
  });

  it('rejects create without name', async () => {
    const res = await app.request('/admin/keys', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ owner: 'test@example.com' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects create with invalid nested settings', async () => {
    const res = await app.request('/admin/keys', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Key',
        rateLimitConfig: { requestsPerMinute: 0, burstAllowance: 10 },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/rateLimitConfig\.requestsPerMinute/);
    expect(body.error.code).toBe('validation_error');
    expect(body.error.type).toBe('invalid_request_error');
  });

  it('rejects invalid model effort values', async () => {
    const res = await app.request('/admin/keys', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Bad Effort Key',
        modelConfig: { model: 'local-model', maxTokens: 250, temperature: 0.2, effort: 'light' },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/modelConfig\.effort/);
  });

  it('rejects unknown compatibility profiles', async () => {
    const res = await app.request('/admin/keys', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Unknown Client',
        compatibilityProfile: 'strip-everything',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/compatibilityProfile/);
    expect(body.error.code).toBe('validation_error');
  });

  it('updates mutable fields with validated settings', async () => {
    const res = await app.request('/admin/keys/key_existing', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Renamed',
        enabled: false,
        rateLimitConfig: { requestsPerMinute: 90, burstAllowance: 12 },
        modelConfig: { model: 'local-model', maxTokens: 250, temperature: 0.2, effort: 'medium' },
        allowedModels: ['local-model'],
        compatibilityProfile: 'universal-ai-connector',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('key_existing');
    expect(body.key).toBe('sk-existing-secret-value');
    expect(body.name).toBe('Renamed');
    expect(body.enabled).toBe(false);
    expect(body.rateLimitConfig).toEqual({ requestsPerMinute: 90, burstAllowance: 12 });
    expect(body.modelConfig).toEqual({ model: 'local-model', maxTokens: 250, temperature: 0.2, effort: 'medium' });
    expect(body.allowedModels).toEqual(['local-model']);
    expect(body.compatibilityProfile).toBe('universal-ai-connector');
  });

  it('rejects attempts to update unknown or immutable fields', async () => {
    const res = await app.request('/admin/keys/key_existing', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'hacked',
        key: 'sk-hacked',
        name: 'Renamed',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/Unknown field/);
  });

  it('rejects invalid update types', async () => {
    const res = await app.request('/admin/keys/key_existing', {
      method: 'PATCH',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: 'false',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toMatch(/enabled/);
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
    await expect(get.json()).resolves.toEqual({
      error: {
        message: 'Key not found',
        type: 'invalid_request_error',
        code: 'key_not_found',
      },
    });

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

  it('checks model status without inference through the authenticated admin route', async () => {
    const status = {
      model: 'local-model',
      provider: 'ollama',
      state: 'available',
      service: 'reachable',
      runtime: 'idle',
      checkedAt: '2026-08-24T00:00:00.000Z',
      checkScope: 'non_inference',
      inferenceVerified: false,
      message: 'Available but idle.',
      start: { supported: true, action: 'load_model', label: 'Load model' },
    } satisfies ModelRuntimeStatus;
    const runtime = {
      checkModels: vi.fn().mockResolvedValue([status]),
      startModel: vi.fn(),
    } as unknown as ModelRuntimeManager;
    ({ app, token } = buildAdminApp(runtime));

    const res = await app.request('/admin/models/status', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ models: ['local-model'] }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ statuses: [status], inferencePerformed: false });
    expect(runtime.checkModels).toHaveBeenCalledWith(['local-model']);
    expect(runtime.startModel).not.toHaveBeenCalled();
  });

  it('runs only the bounded provider start action selected by model', async () => {
    const status = {
      model: 'local-model',
      provider: 'ollama',
      state: 'running',
      service: 'reachable',
      runtime: 'loaded',
      checkedAt: '2026-08-24T00:00:00.000Z',
      checkScope: 'non_inference',
      inferenceVerified: false,
      message: 'Loaded.',
      start: { supported: false },
    } satisfies ModelRuntimeStatus;
    const runtime = {
      checkModels: vi.fn(),
      startModel: vi.fn().mockResolvedValue(status),
    } as unknown as ModelRuntimeManager;
    ({ app, token } = buildAdminApp(runtime));

    const res = await app.request('/admin/models/start', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'local-model' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status, inferencePerformed: false });
    expect(runtime.startModel).toHaveBeenCalledWith('local-model');
  });

  it('rejects malformed, unauthenticated, and command-shaped model control requests', async () => {
    const runtime = {
      checkModels: vi.fn(),
      startModel: vi.fn(),
    } as unknown as ModelRuntimeManager;
    ({ app, token } = buildAdminApp(runtime));

    const unauthenticated = await app.request('/admin/models/status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ models: ['local-model'] }),
    });
    expect(unauthenticated.status).toBe(401);

    const malformed = await app.request('/admin/models/status', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ models: [] }),
    });
    expect(malformed.status).toBe(400);

    const commandShaped = await app.request('/admin/models/start', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'local-model', command: 'anything' }),
    });
    expect(commandShaped.status).toBe(400);
    expect(runtime.startModel).not.toHaveBeenCalled();
  });
});
