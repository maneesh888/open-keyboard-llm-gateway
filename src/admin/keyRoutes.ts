import { Hono } from 'hono';
import { randomBytes } from 'crypto';
import type { Context } from 'hono';
import type { ApiKey, AuthToken, ClientFeatures, CustomAction, ModelConfig, RateLimitConfig } from '../types/index.js';
import { OllamaProxy } from '../proxy/ollama.js';
import { KeyManager } from '../keys/manager.js';
import { AdminAuth } from './auth.js';

type AdminVariables = { admin: AuthToken };
type KeyCreateInput = Pick<ApiKey, 'name'> & Partial<Pick<ApiKey, 'owner' | 'description' | 'enabled' | 'rateLimitConfig' | 'features' | 'modelConfig' | 'allowedModels'>>;
type KeyUpdateInput = Partial<Pick<ApiKey, 'name' | 'owner' | 'description' | 'enabled' | 'rateLimitConfig' | 'features' | 'modelConfig' | 'allowedModels'>>;

const CREATE_FIELDS = new Set(['name', 'owner', 'description', 'enabled', 'rateLimitConfig', 'features', 'modelConfig', 'allowedModels']);
const UPDATE_FIELDS = CREATE_FIELDS;

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertKnownFields(body: Record<string, unknown>, allowedFields: Set<string>): void {
  const unknown = Object.keys(body).filter((field) => !allowedFields.has(field));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown field(s): ${unknown.join(', ')}`);
  }
}

function optionalTrimmedString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredTrimmedString(value: unknown, field: string): string {
  const trimmed = optionalTrimmedString(value, field);
  if (!trimmed) throw new ValidationError(`${field} is required`);
  return trimmed;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new ValidationError(`${field} must be a boolean`);
  return value;
}

function integerInRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function numberInRange(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError(`${field} must be a number between ${min} and ${max}`);
  }
  return value;
}

function parseRateLimitConfig(value: unknown): RateLimitConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) throw new ValidationError('rateLimitConfig must be an object');
  assertKnownFields(value, new Set(['requestsPerMinute', 'burstAllowance']));
  return {
    requestsPerMinute: integerInRange(value.requestsPerMinute, 'rateLimitConfig.requestsPerMinute', 1, 10000),
    burstAllowance: integerInRange(value.burstAllowance, 'rateLimitConfig.burstAllowance', 1, 10000),
  };
}

function parseModelConfig(value: unknown): ModelConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) throw new ValidationError('modelConfig must be an object');
  assertKnownFields(value, new Set(['model', 'maxTokens', 'temperature']));
  return {
    model: requiredTrimmedString(value.model, 'modelConfig.model'),
    maxTokens: integerInRange(value.maxTokens, 'modelConfig.maxTokens', 1, 100000),
    temperature: numberInRange(value.temperature, 'modelConfig.temperature', 0, 2),
  };
}

function parseAllowedModels(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ValidationError('allowedModels must be an array');
  if (value.length === 0) throw new ValidationError('allowedModels must not be empty');
  if (value.length > 100) throw new ValidationError('allowedModels must contain at most 100 models');
  return value.map((item, index) => requiredTrimmedString(item, `allowedModels[${index}]`));
}

function parseCustomAction(value: unknown, index: number): CustomAction {
  if (!isObject(value)) throw new ValidationError(`features.customActions[${index}] must be an object`);
  assertKnownFields(value, new Set(['id', 'label', 'prompt', 'icon']));
  const icon = optionalTrimmedString(value.icon, `features.customActions[${index}].icon`);
  return {
    id: requiredTrimmedString(value.id, `features.customActions[${index}].id`),
    label: requiredTrimmedString(value.label, `features.customActions[${index}].label`),
    prompt: requiredTrimmedString(value.prompt, `features.customActions[${index}].prompt`),
    ...(icon ? { icon } : {}),
  };
}

function parseFeatures(value: unknown): ClientFeatures | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) throw new ValidationError('features must be an object');
  assertKnownFields(value, new Set(['suggestions', 'customActions']));
  if (typeof value.suggestions !== 'boolean') throw new ValidationError('features.suggestions must be a boolean');
  if (!Array.isArray(value.customActions)) throw new ValidationError('features.customActions must be an array');
  if (value.customActions.length > 50) throw new ValidationError('features.customActions must contain at most 50 actions');
  return {
    suggestions: value.suggestions,
    customActions: value.customActions.map(parseCustomAction),
  };
}

function parseCreateInput(body: unknown): KeyCreateInput {
  if (!isObject(body)) throw new ValidationError('Request body must be an object');
  assertKnownFields(body, CREATE_FIELDS);
  const enabled = optionalBoolean(body.enabled, 'enabled');
  return {
    name: requiredTrimmedString(body.name, 'name'),
    owner: optionalTrimmedString(body.owner, 'owner'),
    description: optionalTrimmedString(body.description, 'description'),
    enabled: enabled ?? true,
    rateLimitConfig: parseRateLimitConfig(body.rateLimitConfig),
    features: parseFeatures(body.features),
    modelConfig: parseModelConfig(body.modelConfig),
    allowedModels: parseAllowedModels(body.allowedModels),
  };
}

function parseUpdateInput(body: unknown): KeyUpdateInput {
  if (!isObject(body)) throw new ValidationError('Request body must be an object');
  assertKnownFields(body, UPDATE_FIELDS);
  const updates: KeyUpdateInput = {};

  if ('name' in body) updates.name = requiredTrimmedString(body.name, 'name');
  if ('owner' in body) updates.owner = optionalTrimmedString(body.owner, 'owner');
  if ('description' in body) updates.description = optionalTrimmedString(body.description, 'description');
  if ('enabled' in body) updates.enabled = optionalBoolean(body.enabled, 'enabled');
  if ('rateLimitConfig' in body) updates.rateLimitConfig = parseRateLimitConfig(body.rateLimitConfig);
  if ('features' in body) updates.features = parseFeatures(body.features);
  if ('modelConfig' in body) updates.modelConfig = parseModelConfig(body.modelConfig);
  if ('allowedModels' in body) updates.allowedModels = parseAllowedModels(body.allowedModels);

  return updates;
}

function validationResponse(c: Context, error: unknown): Response | null {
  if (error instanceof ValidationError) {
    return c.json({ error: error.message }, 400);
  }
  return null;
}

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
      const input = parseCreateInput(await c.req.json());

      const newKey: ApiKey = {
        id: `key_${randomBytes(8).toString('hex')}`,
        name: input.name,
        key: `sk-${randomBytes(24).toString('hex')}`,
        enabled: input.enabled ?? true,
        rateLimitConfig: input.rateLimitConfig || { requestsPerMinute: 30, burstAllowance: 10 },
        features: input.features || { suggestions: true, customActions: [] },
        modelConfig: input.modelConfig || { model: 'gemma4:latest', maxTokens: 100, temperature: 0.7 },
        allowedModels: input.allowedModels || ['*'],
        owner: input.owner,
        description: input.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const allKeys = keyManager.getKeys();
      allKeys.push(newKey);
      await keyManager.saveKeys(allKeys);

      return c.json(newKey, 201);
    } catch (error) {
      const response = validationResponse(c, error);
      if (response) return response;
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
      const updates = parseUpdateInput(await c.req.json());

      const allKeys = keyManager.getKeys();
      const keyIndex = allKeys.findIndex(k => k.id === id);

      if (keyIndex === -1) {
        return c.json({ error: 'Key not found' }, 404);
      }

      // Merge updates
      allKeys[keyIndex] = {
        ...allKeys[keyIndex],
        ...updates,
        id,
        key: allKeys[keyIndex].key,
        updatedAt: new Date().toISOString()
      };

      await keyManager.saveKeys(allKeys);

      return c.json(allKeys[keyIndex]);
    } catch (error) {
      const response = validationResponse(c, error);
      if (response) return response;
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
