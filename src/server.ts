import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFileSync } from 'fs';
import { join } from 'path';
import { KeyManager } from './keys/manager.js';
import { authMiddleware } from './middleware/auth.js';
import { RateLimiter } from './middleware/rateLimit.js';
import { trustedProxyMiddleware } from './middleware/trustedProxy.js';
import { OllamaProxy } from './proxy/ollama.js';
import { loggingMiddleware } from './logging/logger.js';
import { createAdminApp } from './admin/index.js';
import type { AppConfig, AdminConfig } from './types/index.js';

export function createApp(config: AppConfig, keysPath: string, adminConfig?: AdminConfig) {
  const app = new Hono();
  const keyManager = new KeyManager(keysPath);
  const rateLimiter = new RateLimiter();
  const proxy = new OllamaProxy(config.ollamaHost);

  keyManager.watchForChanges();

  // Treat ['*'] as "allow all origins" — Hono's cors expects the string '*', not an array
  const corsOrigin: string | string[] = config.corsOrigins.includes('*') ? '*' : config.corsOrigins;
  app.use('*', cors({ origin: corsOrigin }));
  app.use('*', trustedProxyMiddleware(config));

  const healthCheck = async () => {
    const ollamaOk = await proxy.healthCheck();
    return { status: 'ok', ollama: ollamaOk ? 'connected' : 'disconnected' } as const;
  };

  app.get('/', async (c) => c.json(await healthCheck()));
  app.get('/health', async (c) => c.json(await healthCheck()));

  // Admin routes (if config provided)
  if (adminConfig) {
    const adminApp = createAdminApp(adminConfig, keyManager, proxy, config);
    app.route('/admin', adminApp);
    console.log('[gateway] Admin API enabled at /admin');
  }

  // Admin UI (static HTML) - must be after admin API routes
  app.get('/ui', (c) => {
    try {
      const htmlPath = join(process.cwd(), 'public', 'admin', 'index.html');
      const html = readFileSync(htmlPath, 'utf-8');
      c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      c.header('Pragma', 'no-cache');
      c.header('Expires', '0');
      return c.html(html);
    } catch (error) {
      return c.text('Admin UI not found', 404);
    }
  });

  if (adminConfig) {
    console.log('[gateway] Admin UI available at http://localhost:' + config.port + '/ui');
  }

  app.use('/v1/*', authMiddleware(keyManager));
  app.use('/v1/*', rateLimiter.middleware());
  app.use('/v1/*', loggingMiddleware());

  app.all('/v1/*', (c) => proxy.forward(c));

  return { app, keyManager, proxy };
}
