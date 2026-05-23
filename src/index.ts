import { serve } from '@hono/node-server';
import { readFileSync, existsSync } from 'fs';
import { createApp } from './server.js';
import type { AppConfig, AdminConfig } from './types/index.js';

const configPath = process.env.CONFIG_PATH || './config/config.json';
const keysPath = process.env.KEYS_PATH || './config/keys.json';
const adminConfigPath = process.env.ADMIN_CONFIG_PATH || './config/admin.json';

let config: AppConfig;
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch {
  config = {
    port: parseInt(process.env.PORT || '8080'),
    ollamaHost: process.env.OLLAMA_HOST || 'http://host.docker.internal:11434',
    logLevel: 'info',
    corsOrigins: ['*'],
  };
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

serve({ fetch: app.fetch, port: config.port });
