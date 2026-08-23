import { existsSync, readFileSync } from 'fs';
import type { AppConfig, CodexConfig } from '../types/index.js';

export type ConfigEnv = {
  PORT?: string;
  OLLAMA_HOST?: string;
  APFEL_HOST?: string;
  ALLOW_LOCAL_SERVICE_START?: string;
};

export const DEFAULT_CODEX_CONFIG: CodexConfig = {
  enabled: false,
  publicModel: 'codex',
  timeoutMs: 120000,
  maxConcurrent: 1,
  maxQueue: 2,
  maxInputChars: 32000,
  maxOutputChars: 16000,
};

export function defaultConfig(env: ConfigEnv = process.env): AppConfig {
  return {
    port: parseInt(env.PORT || '8080'),
    ollamaHost: env.OLLAMA_HOST || 'http://host.docker.internal:11434',
    apfelHost: env.APFEL_HOST || undefined,
    allowLocalServiceStart: env.ALLOW_LOCAL_SERVICE_START === 'true',
    codex: { ...DEFAULT_CODEX_CONFIG },
    logLevel: 'info',
    corsOrigins: ['*'],
  };
}

function validateBoundedInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < minimum || value > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function validateCodexConfig(raw: unknown): CodexConfig {
  if (raw === undefined) return { ...DEFAULT_CODEX_CONFIG };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('codex must be an object');
  }

  const value = raw as Partial<CodexConfig> & Record<string, unknown>;
  const supportedFields = new Set([
    'enabled',
    'publicModel',
    'model',
    'timeoutMs',
    'maxConcurrent',
    'maxQueue',
    'maxInputChars',
    'maxOutputChars',
  ]);
  if ('apiKey' in value || 'credential' in value || 'secret' in value) {
    throw new Error('Codex credentials must be supplied through the protected CODEX_API_KEY environment variable');
  }
  if (Object.keys(value).some((field) => !supportedFields.has(field))) {
    throw new Error('codex contains unsupported configuration fields');
  }
  if (typeof value.enabled !== 'boolean') throw new Error('codex.enabled must be a boolean');
  if (value.publicModel === '*' || value.publicModel === 'apple-foundationmodel') {
    throw new Error('codex.publicModel conflicts with a reserved model identifier');
  }
  if (typeof value.publicModel !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.publicModel)) {
    throw new Error('codex.publicModel must be a non-empty model alias without whitespace');
  }

  const model = typeof value.model === 'string' ? value.model.trim() : undefined;
  if (value.enabled && !model) throw new Error('codex.model must be configured when codex.enabled is true');
  if (model && !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) {
    throw new Error('codex.model must be a bounded model identifier without whitespace');
  }

  return {
    enabled: value.enabled,
    publicModel: value.publicModel,
    ...(model ? { model } : {}),
    timeoutMs: validateBoundedInteger(value.timeoutMs, 'codex.timeoutMs', 1000, 300000),
    maxConcurrent: validateBoundedInteger(value.maxConcurrent, 'codex.maxConcurrent', 1, 4),
    maxQueue: validateBoundedInteger(value.maxQueue, 'codex.maxQueue', 0, 100),
    maxInputChars: validateBoundedInteger(value.maxInputChars, 'codex.maxInputChars', 100, 100000),
    maxOutputChars: validateBoundedInteger(value.maxOutputChars, 'codex.maxOutputChars', 100, 100000),
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

export function validateConfig(raw: unknown): AppConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('config must be an object');
  }

  const config = raw as Partial<AppConfig>;
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
    codex: validateCodexConfig(config.codex),
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
