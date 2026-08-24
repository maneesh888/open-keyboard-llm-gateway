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
import { ModelRuntimeManager, type LocalServiceLauncher } from './models/runtime.js';
import { HttpModelServiceController, type ModelServiceController } from './models/serviceController.js';
import { protectedValue } from './lib/protectedValue.js';

export type AppDependencies = {
  localServiceLauncher?: LocalServiceLauncher;
  modelServiceController?: ModelServiceController;
};

export function createApp(
  config: AppConfig,
  keysPath: string,
  adminConfig?: AdminConfig,
  dependencies: AppDependencies = {},
) {
  const app = new Hono();
  const keyManager = new KeyManager(keysPath);
  const rateLimiter = new RateLimiter();
  const serviceControllerToken = protectedValue('MODEL_SERVICE_CONTROL_TOKEN', 'MODEL_SERVICE_CONTROL_TOKEN_FILE');
  const modelServiceController = dependencies.modelServiceController
    || (config.modelServiceControllerUrl && serviceControllerToken
      ? new HttpModelServiceController(new URL(config.modelServiceControllerUrl), serviceControllerToken)
      : undefined);
  const proxy = new OllamaProxy(
    config.ollamaHost,
    config.apfelHost,
    './config/known-models.json',
  );
  const modelRuntime = new ModelRuntimeManager({
    ollamaHost: config.ollamaHost,
    apfelHost: config.apfelHost,
    allowLocalServiceStart: config.allowLocalServiceStart,
    launcher: dependencies.localServiceLauncher,
    serviceController: modelServiceController,
  });

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
    const adminApp = createAdminApp(adminConfig, keyManager, proxy, config, modelRuntime);
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

  app.get('/ui/semantic-prompt-contract.js', (c) => {
    try {
      const adapterPath = join(
        process.cwd(),
        'Vendor',
        'semantic-prompt-contract',
        'adapters',
        'browser',
        'semanticPromptContract.generated.js',
      );
      const source = readFileSync(adapterPath, 'utf-8');
      c.header('Content-Type', 'text/javascript; charset=UTF-8');
      c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      return c.body(source);
    } catch (error) {
      return c.text('Semantic prompt contract adapter not found', 404);
    }
  });

  app.get('/ui/playground.js', (c) => {
    try {
      const source = readFileSync(join(process.cwd(), 'public', 'admin', 'playground.js'), 'utf-8');
      c.header('Content-Type', 'text/javascript; charset=UTF-8');
      c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      return c.body(source);
    } catch (error) {
      return c.text('Admin Playground logic not found', 404);
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
