import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { defaultConfig, loadConfig, validateConfig } from '../../src/config/appConfig.js';

function tempPath(filename: string): string {
  const dir = join(tmpdir(), 'llm-gateway-config-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  mkdirSync(dir, { recursive: true });
  return join(dir, filename);
}

describe('app config loading', () => {
  it('uses validated environment defaults when config file is missing', () => {
    const config = loadConfig(tempPath('missing.json'), {
      PORT: '9090',
      OLLAMA_HOST: 'http://localhost:11434/',
      APFEL_HOST: 'http://localhost:11435/',
    });

    expect(config).toEqual({
      port: 9090,
      ollamaHost: 'http://localhost:11434',
      apfelHost: 'http://localhost:11435',
      logLevel: 'info',
      corsOrigins: ['*'],
      trustedProxies: undefined,
    });
  });

  it('loads and normalizes valid file config', () => {
    const path = tempPath('config.json');
    writeFileSync(path, JSON.stringify({
      port: 8080,
      ollamaHost: 'http://localhost:11434/',
      apfelHost: 'https://apfel.example/',
      logLevel: ' info ',
      corsOrigins: [' https://app.example '],
      trustedProxies: [' 10.0.0.0/8 '],
    }));

    expect(loadConfig(path)).toEqual({
      port: 8080,
      ollamaHost: 'http://localhost:11434',
      apfelHost: 'https://apfel.example',
      logLevel: 'info',
      corsOrigins: ['https://app.example'],
      trustedProxies: ['10.0.0.0/8'],
    });
  });

  it('throws instead of silently falling back when config file is malformed', () => {
    const path = tempPath('bad.json');
    writeFileSync(path, '{ not json');

    expect(() => loadConfig(path)).toThrow(/Failed to load/);
  });

  it('rejects invalid config values', () => {
    expect(() => validateConfig({
      port: 0,
      ollamaHost: 'http://localhost:11434',
      logLevel: 'info',
      corsOrigins: ['*'],
    })).toThrow(/port/);

    expect(() => validateConfig({
      port: 8080,
      ollamaHost: 'file:///tmp/model',
      logLevel: 'info',
      corsOrigins: ['*'],
    })).toThrow(/ollamaHost/);

    expect(() => validateConfig({
      port: 8080,
      ollamaHost: 'not a url',
      logLevel: 'info',
      corsOrigins: ['*'],
    })).toThrow(/ollamaHost/);
  });

  it('keeps default config valid', () => {
    expect(validateConfig(defaultConfig())).toMatchObject({
      port: 8080,
      ollamaHost: 'http://host.docker.internal:11434',
      logLevel: 'info',
      corsOrigins: ['*'],
    });
  });
});
