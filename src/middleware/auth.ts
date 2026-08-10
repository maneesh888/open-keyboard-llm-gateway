import type { Context, Next } from 'hono';
import type { KeyManager } from '../keys/manager.js';
import { errorResponse } from '../lib/errors.js';

export function authMiddleware(keyManager: KeyManager) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return errorResponse(c, 401, 'missing_authorization', 'Missing Authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token || token === authHeader) {
      return errorResponse(c, 401, 'invalid_authorization_format', 'Invalid Authorization format. Use: Bearer sk-xxx');
    }

    const apiKey = keyManager.validate(token);
    if (!apiKey) {
      return errorResponse(c, 401, 'invalid_api_key', 'Invalid or disabled API key');
    }

    c.set('apiKey', apiKey);
    await next();
  };
}
