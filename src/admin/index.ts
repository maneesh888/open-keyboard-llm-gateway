import { Hono } from 'hono';
import { AdminAuth } from './auth.js';
import { createAdminRoutes } from './keyRoutes.js';
import type { AdminConfig, AppConfig } from '../types/index.js';
import { OllamaProxy } from '../proxy/ollama.js';
import type { KeyManager } from '../keys/manager.js';

export function createAdminApp(adminConfig: AdminConfig, keyManager: KeyManager, proxy?: OllamaProxy, appConfig?: AppConfig) {
  const app = new Hono();
  const adminAuth = new AdminAuth(adminConfig);
  const loginAttempts = new Map<string, { count: number; resetAt: number }>();
  const maxLoginAttempts = 5;
  const loginWindowMs = 15 * 60 * 1000;

  function loginAttemptKey(c: { get: (key: string) => unknown }): string {
    const trustedProxyMode = (appConfig?.trustedProxies?.length ?? 0) > 0;
    if (!trustedProxyMode) return 'direct';

    const clientIp = c.get('clientIp');
    return typeof clientIp === 'string' && clientIp.length > 0 ? clientIp : 'direct';
  }

  function isLoginRateLimited(key: string): boolean {
    const now = Date.now();
    const attempt = loginAttempts.get(key);
    if (!attempt || attempt.resetAt <= now) {
      loginAttempts.set(key, { count: 0, resetAt: now + loginWindowMs });
      return false;
    }

    return attempt.count >= maxLoginAttempts;
  }

  function recordFailedLogin(key: string): void {
    const now = Date.now();
    const attempt = loginAttempts.get(key);
    if (!attempt || attempt.resetAt <= now) {
      loginAttempts.set(key, { count: 1, resetAt: now + loginWindowMs });
      return;
    }

    attempt.count += 1;
  }

  function clearFailedLogins(key: string): void {
    loginAttempts.delete(key);
  }

  // POST /admin/login - Authenticate and get token
  app.post('/login', async (c) => {
    try {
      const attemptKey = loginAttemptKey(c);
      if (isLoginRateLimited(attemptKey)) {
        return c.json({ error: 'Too many login attempts. Try again later.' }, 429);
      }

      const { username, password } = await c.req.json();

      if (!username || !password) {
        recordFailedLogin(attemptKey);
        return c.json({ error: 'Invalid credentials' }, 401);
      }

      const isValid = await adminAuth.verifyPassword(username, password);
      if (!isValid) {
        recordFailedLogin(attemptKey);
        return c.json({ error: 'Invalid credentials' }, 401);
      }

      clearFailedLogins(attemptKey);
      const token = adminAuth.generateToken(username);

      return c.json({
        token,
        expiresIn: adminConfig.sessionExpiryHours * 3600
      });
    } catch (error) {
      console.error('[admin] Login error:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  // Mount key management routes
  app.route('/', createAdminRoutes(keyManager, adminAuth, proxy));

  return app;
}

export { AdminAuth };
