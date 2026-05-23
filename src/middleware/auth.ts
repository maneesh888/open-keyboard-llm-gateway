import type { Context, Next } from 'hono';
import type { KeyManager } from '../keys/manager.js';

export function authMiddleware(keyManager: KeyManager) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) {
      return c.json({ error: 'Missing Authorization header' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token || token === authHeader) {
      return c.json({ error: 'Invalid Authorization format. Use: Bearer sk-xxx' }, 401);
    }

    const apiKey = keyManager.validate(token);
    if (!apiKey) {
      return c.json({ error: 'Invalid or disabled API key' }, 401);
    }

    c.set('apiKey', apiKey);
    await next();
  };
}
