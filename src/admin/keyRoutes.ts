import { Hono } from 'hono';
import { randomBytes } from 'crypto';
import type { Context } from 'hono';
import type { ApiKey, AuthToken, ClientFeatures, CompatibilityProfile, CustomAction, EffortMode, ModelConfig, RateLimitConfig } from '../types/index.js';
import { OllamaProxy, UpstreamResponseError } from '../proxy/ollama.js';
import { KeyManager } from '../keys/manager.js';
import { AdminAuth } from './auth.js';
import { errorResponse } from '../lib/errors.js';
import { ModelControlError, type ModelRuntimeManager } from '../models/runtime.js';

type AdminVariables = { admin: AuthToken };
type KeyCreateInput = Pick<ApiKey, 'name'> & Partial<Pick<ApiKey, 'owner' | 'description' | 'enabled' | 'rateLimitConfig' | 'features' | 'modelConfig' | 'allowedModels' | 'compatibilityProfile'>>;
type KeyUpdateInput = Partial<Pick<ApiKey, 'name' | 'owner' | 'description' | 'enabled' | 'rateLimitConfig' | 'features' | 'modelConfig' | 'allowedModels' | 'compatibilityProfile'>>;

const CREATE_FIELDS = new Set(['name', 'owner', 'description', 'enabled', 'rateLimitConfig', 'features', 'modelConfig', 'allowedModels', 'compatibilityProfile']);
const UPDATE_FIELDS = CREATE_FIELDS;
const EFFORT_MODES = new Set<EffortMode>(['low', 'medium', 'high']);
const COMPATIBILITY_PROFILES = new Set<CompatibilityProfile>(['universal-ai-connector']);

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

function optionalEffortMode(value: unknown, field: string): EffortMode | undefined {
  const trimmed = optionalTrimmedString(value, field);
  if (!trimmed) return undefined;
  if (!EFFORT_MODES.has(trimmed as EffortMode)) {
    throw new ValidationError(`${field} must be one of: low, medium, high`);
  }
  return trimmed as EffortMode;
}

function optionalCompatibilityProfile(value: unknown): CompatibilityProfile | undefined {
  const trimmed = optionalTrimmedString(value, 'compatibilityProfile');
  if (!trimmed) return undefined;
  if (!COMPATIBILITY_PROFILES.has(trimmed as CompatibilityProfile)) {
    throw new ValidationError('compatibilityProfile must be universal-ai-connector');
  }
  return trimmed as CompatibilityProfile;
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
  assertKnownFields(value, new Set(['model', 'maxTokens', 'temperature', 'effort']));
  const effort = optionalEffortMode(value.effort, 'modelConfig.effort');
  return {
    model: requiredTrimmedString(value.model, 'modelConfig.model'),
    maxTokens: integerInRange(value.maxTokens, 'modelConfig.maxTokens', 1, 100000),
    temperature: numberInRange(value.temperature, 'modelConfig.temperature', 0, 2),
    ...(effort ? { effort } : {}),
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
    compatibilityProfile: optionalCompatibilityProfile(body.compatibilityProfile),
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
  if ('compatibilityProfile' in body) updates.compatibilityProfile = optionalCompatibilityProfile(body.compatibilityProfile);

  return updates;
}

function validationResponse(c: Context, error: unknown): Response | null {
  if (error instanceof ValidationError) {
    return errorResponse(c, 400, 'validation_error', error.message);
  }
  return null;
}

export function createAdminRoutes(
  keyManager: KeyManager,
  adminAuth: AdminAuth,
  proxy?: OllamaProxy,
  modelRuntime?: ModelRuntimeManager,
) {
  const app = new Hono<{ Variables: AdminVariables }>();

  // Middleware: Verify admin token
  app.use('*', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse(c, 401, 'admin_unauthorized', 'Unauthorized');
    }

    const token = authHeader.substring(7);
    const payload = adminAuth.verifyToken(token);
    
    if (!payload) {
      return errorResponse(c, 401, 'admin_invalid_token', 'Invalid or expired token');
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
      if (error instanceof UpstreamResponseError) {
        return errorResponse(c, 502, 'upstream_error', 'Upstream model request failed.', {
          upstreamStatus: error.upstreamStatus,
          models: [],
        });
      }
      if (error?.name === 'TimeoutError') {
        return errorResponse(c, 504, 'upstream_timeout', 'Ollama request timed out', { models: [] });
      }
      return errorResponse(c, 502, 'upstream_unreachable', 'Failed to load models', {
        models: [],
      });
    }
  });

  // POST /admin/models/status - Bounded, non-inference availability checks.
  app.post('/models/status', async (c) => {
    try {
      if (!modelRuntime) return errorResponse(c, 503, 'model_status_unavailable', 'Model status checks are unavailable');
      const body = await c.req.json() as unknown;
      if (!isObject(body) || !Array.isArray(body.models) || body.models.length === 0 || body.models.length > 100) {
        throw new ValidationError('models must be a non-empty array containing at most 100 model identifiers');
      }
      const statuses = await modelRuntime.checkModels(body.models);
      return c.json({ statuses, inferencePerformed: false });
    } catch (error) {
      if (error instanceof ModelControlError || error instanceof ValidationError) {
        return errorResponse(c, 400, 'validation_error', error.message);
      }
      return errorResponse(c, 502, 'model_status_failed', 'Model status check failed');
    }
  });

  // POST /admin/models/start - Safe provider-owned activation only; never accepts commands.
  app.post('/models/start', async (c) => {
    try {
      if (!modelRuntime) return errorResponse(c, 503, 'model_control_unavailable', 'Model start controls are unavailable');
      const body = await c.req.json() as unknown;
      if (!isObject(body) || Object.keys(body).some((field) => field !== 'model')) {
        throw new ValidationError('Request body must contain only model');
      }
      const status = await modelRuntime.startModel(body.model);
      return c.json({ status, inferencePerformed: false });
    } catch (error) {
      if (error instanceof ValidationError || (error instanceof ModelControlError && error.code === 'invalid_model')) {
        return errorResponse(c, 400, 'validation_error', error.message);
      }
      if (error instanceof ModelControlError && error.code === 'start_not_supported') {
        return errorResponse(c, 409, error.code, error.message);
      }
      if (error instanceof ModelControlError) {
        const code = error.code === 'model_not_available' ? 'model_not_available' : 'start_failed';
        return errorResponse(c, 503, code, error.message);
      }
      return errorResponse(c, 503, 'start_failed', 'The bounded model start action failed');
    }
  });

  // POST /admin/models/stop - Bounded provider-owned model deactivation only.
  app.post('/models/stop', async (c) => {
    try {
      if (!modelRuntime) return errorResponse(c, 503, 'model_control_unavailable', 'Model stop controls are unavailable');
      const body = await c.req.json() as unknown;
      if (!isObject(body) || Object.keys(body).some((field) => field !== 'model')) {
        throw new ValidationError('Request body must contain only model');
      }
      const status = await modelRuntime.stopModel(body.model);
      return c.json({ status, inferencePerformed: false });
    } catch (error) {
      if (error instanceof ValidationError || (error instanceof ModelControlError && error.code === 'invalid_model')) {
        return errorResponse(c, 400, 'validation_error', error.message);
      }
      if (error instanceof ModelControlError && error.code === 'stop_not_supported') {
        return errorResponse(c, 409, error.code, error.message);
      }
      if (error instanceof ModelControlError) {
        return errorResponse(c, 503, 'stop_failed', error.message);
      }
      return errorResponse(c, 503, 'stop_failed', 'The bounded model stop action failed');
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
        compatibilityProfile: input.compatibilityProfile,
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
      return errorResponse(c, 500, 'internal_error', 'Internal server error');
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
      return errorResponse(c, 404, 'key_not_found', 'Key not found');
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
        return errorResponse(c, 404, 'key_not_found', 'Key not found');
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
      return errorResponse(c, 500, 'internal_error', 'Internal server error');
    }
  });

  // DELETE /admin/keys/:id - Delete API key
  app.delete('/keys/:id', async (c) => {
    try {
      const { id } = c.req.param();

      const allKeys = keyManager.getKeys();
      const filtered = allKeys.filter(k => k.id !== id);

      if (filtered.length === allKeys.length) {
        return errorResponse(c, 404, 'key_not_found', 'Key not found');
      }

      await keyManager.saveKeys(filtered);

      return c.json({ message: 'Key deleted successfully' });
    } catch (error) {
      console.error('[admin] Error deleting key:', error);
      return errorResponse(c, 500, 'internal_error', 'Internal server error');
    }
  });

  return app;
}
