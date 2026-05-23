import { describe, it, expect, beforeAll } from 'vitest';
import { KeyManager } from '../src/keys/manager.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('KeyManager', () => {
  let keysPath: string;
  let km: KeyManager;

  beforeAll(() => {
    const dir = join(tmpdir(), 'llm-gateway-keys-' + Date.now());
    mkdirSync(dir, { recursive: true });
    keysPath = join(dir, 'keys.json');
    writeFileSync(keysPath, JSON.stringify({
      keys: [
        { id: 'k1', name: 'Test', key: 'sk-valid', enabled: true, allowedModels: ['gemma4'], createdAt: '2026-01-01' },
        { id: 'k2', name: 'All', key: 'sk-all', enabled: true, allowedModels: ['*'], createdAt: '2026-01-01' },
      ]
    }));
    km = new KeyManager(keysPath);
  });

  it('validates correct key', () => {
    expect(km.validate('sk-valid')).not.toBeNull();
  });

  it('rejects unknown key', () => {
    expect(km.validate('sk-unknown')).toBeNull();
  });

  it('checks model allowlist', () => {
    const key = km.validate('sk-valid')!;
    expect(km.isModelAllowed(key, 'gemma4')).toBe(true);
    expect(km.isModelAllowed(key, 'gpt-4')).toBe(false);
  });

  it('wildcard allows all models', () => {
    const key = km.validate('sk-all')!;
    expect(km.isModelAllowed(key, 'anything')).toBe(true);
  });

  it('lists all keys', () => {
    expect(km.getAllKeys()).toHaveLength(2);
  });
});
