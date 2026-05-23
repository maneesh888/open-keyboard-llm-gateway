import { Hono } from 'hono';
import { randomBytes } from 'crypto';
import type { ApiKey, AuthToken } from '../types/index.js';
import { OllamaProxy } from '../proxy/ollama.js';
import { KeyManager } from '../keys/manager.js';
import { AdminAuth } from './auth.js';

type AdminVariables = { admin: AuthToken };

export function createAdminRoutes(keyManager: KeyManager, adminAuth: AdminAuth, proxy?: OllamaProxy) {
  const app = new Hono<{ Variables: AdminVariables }>();

  // Middleware: Verify admin token
  app.use('*', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.substring(7);
    const payload = adminAuth.verifyToken(token);
    
    if (!payload) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    c.set('admin', payload);
    await next();
  });

  // GET /admin/models - List available Ollama/gateway models for selectors
  app.get('/models', async (c) => {
    try {
      const models = proxy ? await proxy.listModels() : [];
      return c.json({ models });
    } catch (error: any) {
      return c.json({ error: 'Failed to load models', detail: error?.message || String(error), models: [] }, 502);
    }
  });

  // POST /admin/keys - Create new API key
  app.post('/keys', async (c) => {
    try {
      const body = await c.req.json();
      const { name, owner, description, rateLimitConfig, features, modelConfig } = body;

      if (!name) {
        return c.json({ error: 'Name is required' }, 400);
      }

      const newKey: ApiKey = {
        id: `key_${randomBytes(8).toString('hex')}`,
        name,
        key: `sk-${randomBytes(24).toString('hex')}`,
        enabled: true,
        rateLimitConfig: rateLimitConfig || { requestsPerMinute: 30, burstAllowance: 10 },
        features: features || { suggestions: true, customActions: [] },
        modelConfig: modelConfig || { model: 'gemma4:latest', maxTokens: 100, temperature: 0.7 },
        owner,
        description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const allKeys = keyManager.getKeys();
      allKeys.push(newKey);
      await keyManager.saveKeys(allKeys);

      return c.json(newKey, 201);
    } catch (error) {
      console.error('[admin] Error creating key:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  // GET /admin/keys - List all API keys
  app.get('/keys', (c) => {
    const keys = keyManager.getKeys();
    // Don't expose the actual key value in list view
    const sanitized = keys.map(k => ({
      ...k,
      key: k.key.substring(0, 10) + '...'
    }));
    return c.json({ keys: sanitized });
  });

  // GET /admin/keys/:id - Get specific API key
  app.get('/keys/:id', (c) => {
    const { id } = c.req.param();
    const key = keyManager.getKeys().find(k => k.id === id);
    
    if (!key) {
      return c.json({ error: 'Key not found' }, 404);
    }

    return c.json(key);
  });

  // PATCH /admin/keys/:id - Update API key
  app.patch('/keys/:id', async (c) => {
    try {
      const { id } = c.req.param();
      const updates = await c.req.json();

      const allKeys = keyManager.getKeys();
      const keyIndex = allKeys.findIndex(k => k.id === id);

      if (keyIndex === -1) {
        return c.json({ error: 'Key not found' }, 404);
      }

      // Merge updates
      allKeys[keyIndex] = {
        ...allKeys[keyIndex],
        ...updates,
        id, // Prevent ID change
        key: allKeys[keyIndex].key, // Prevent key value change
        updatedAt: new Date().toISOString()
      };

      await keyManager.saveKeys(allKeys);

      return c.json(allKeys[keyIndex]);
    } catch (error) {
      console.error('[admin] Error updating key:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  // DELETE /admin/keys/:id - Delete API key
  app.delete('/keys/:id', async (c) => {
    try {
      const { id } = c.req.param();

      const allKeys = keyManager.getKeys();
      const filtered = allKeys.filter(k => k.id !== id);

      if (filtered.length === allKeys.length) {
        return c.json({ error: 'Key not found' }, 404);
      }

      await keyManager.saveKeys(filtered);

      return c.json({ message: 'Key deleted successfully' });
    } catch (error) {
      console.error('[admin] Error deleting key:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  return app;
}
