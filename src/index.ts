import { serve } from '@hono/node-server';
import { readFileSync, existsSync } from 'fs';
import { createApp } from './server.js';
import { loadConfig } from './config/appConfig.js';
import type { AppConfig, AdminConfig } from './types/index.js';

const configPath = process.env.CONFIG_PATH || './config/config.json';
const keysPath = process.env.KEYS_PATH || './config/keys.json';
const adminConfigPath = process.env.ADMIN_CONFIG_PATH || './config/admin.json';

let config: AppConfig;
try {
  config = loadConfig(configPath);
} catch (error) {
  console.error('[gateway] Invalid server config:', error instanceof Error ? error.message : error);
  process.exit(1);
}

let adminConfig: AdminConfig | undefined;
if (existsSync(adminConfigPath)) {
  try {
    adminConfig = JSON.parse(readFileSync(adminConfigPath, 'utf-8'));
    console.log('[gateway] Admin config loaded');
  } catch (error) {
    console.error('[gateway] Failed to load admin config:', error);
  }
} else {
  console.log('[gateway] No admin config found, admin API disabled');
}

const { app } = createApp(config, keysPath, adminConfig);

console.log(`[gateway] Starting on port ${config.port}`);
console.log(`[gateway] Proxying to ${config.ollamaHost}`);
if (config.apfelHost) {
  console.log(`[gateway] Apfel backend enabled at ${config.apfelHost}`);
}

serve({ fetch: app.fetch, port: config.port });
