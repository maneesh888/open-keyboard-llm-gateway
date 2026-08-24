import { existsSync, readFileSync } from 'fs';
import type { AppConfig } from '../types/index.js';

export type ConfigEnv = {
  PORT?: string;
  OLLAMA_HOST?: string;
  APFEL_HOST?: string;
  ALLOW_LOCAL_SERVICE_START?: string;
  MODEL_SERVICE_CONTROLLER_URL?: string;
};

export function defaultConfig(env: ConfigEnv = process.env): AppConfig {
  return {
    port: parseInt(env.PORT || '8080'),
    ollamaHost: env.OLLAMA_HOST || 'http://host.docker.internal:11434',
    apfelHost: env.APFEL_HOST || undefined,
    allowLocalServiceStart: env.ALLOW_LOCAL_SERVICE_START === 'true',
    modelServiceControllerUrl: env.MODEL_SERVICE_CONTROLLER_URL || undefined,
    logLevel: 'info',
    corsOrigins: ['*'],
  };
}

function validateURL(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty URL string`);
  }

  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${field} must use http or https`);
  }
  return trimmed.replace(/\/$/, '');
}

function validateModelServiceControllerURL(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const normalized = validateURL(value, 'modelServiceControllerUrl');
  const target = new URL(normalized);
  if (target.protocol !== 'http:'
    || !['', '/'].includes(target.pathname)
    || target.username
    || target.password
    || target.search
    || target.hash
    || !['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(target.hostname)) {
    throw new Error('modelServiceControllerUrl must be an exact plain-HTTP loopback or host.docker.internal origin');
  }
  return normalized;
}

export function validateConfig(raw: unknown): AppConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('config must be an object');
  }

  const config = raw as Partial<AppConfig> & Record<string, unknown>;
  if ('codex' in config) {
    throw new Error('codex configuration is no longer supported');
  }
  const port = config.port;
  if (!Number.isInteger(port) || port === undefined || port < 1 || port > 65535) {
    throw new Error('port must be an integer between 1 and 65535');
  }
  if (typeof config.logLevel !== 'string' || config.logLevel.trim().length === 0) {
    throw new Error('logLevel must be a non-empty string');
  }
  if (!Array.isArray(config.corsOrigins) || config.corsOrigins.length === 0 || config.corsOrigins.some((origin) => typeof origin !== 'string' || origin.trim().length === 0)) {
    throw new Error('corsOrigins must be a non-empty string array');
  }
  if (config.trustedProxies !== undefined && (!Array.isArray(config.trustedProxies) || config.trustedProxies.some((cidr) => typeof cidr !== 'string' || cidr.trim().length === 0))) {
    throw new Error('trustedProxies must be a string array when provided');
  }
  if (config.allowLocalServiceStart !== undefined && typeof config.allowLocalServiceStart !== 'boolean') {
    throw new Error('allowLocalServiceStart must be a boolean when provided');
  }

  return {
    port,
    ollamaHost: validateURL(config.ollamaHost, 'ollamaHost'),
    apfelHost: config.apfelHost === undefined ? undefined : validateURL(config.apfelHost, 'apfelHost'),
    allowLocalServiceStart: config.allowLocalServiceStart ?? false,
    modelServiceControllerUrl: validateModelServiceControllerURL(config.modelServiceControllerUrl),
    logLevel: config.logLevel.trim(),
    corsOrigins: config.corsOrigins.map((origin) => origin.trim()),
    trustedProxies: config.trustedProxies?.map((cidr) => cidr.trim()),
  };
}

export function loadConfig(configPath: string, env: ConfigEnv = process.env): AppConfig {
  if (!existsSync(configPath)) {
    return validateConfig(defaultConfig(env));
  }

  try {
    return validateConfig(JSON.parse(readFileSync(configPath, 'utf-8')));
  } catch (error) {
    throw new Error(`Failed to load ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
