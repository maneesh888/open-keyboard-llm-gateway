import { readFileSync, writeFileSync, watchFile } from 'fs';
import type { ApiKey, KeysConfig } from '../types/index.js';

export class KeyManager {
  private keys: Map<string, ApiKey> = new Map();
  private configPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
    this.loadKeys();
  }

  loadKeys(): void {
    const raw = readFileSync(this.configPath, 'utf-8');
    const config: KeysConfig = JSON.parse(raw);
    this.keys.clear();
    for (const key of config.keys) {
      this.keys.set(key.key, key);
    }
    console.log(`[keys] Loaded ${this.keys.size} API keys`);
  }

  watchForChanges(): void {
    watchFile(this.configPath, { interval: 5000 }, () => {
      console.log('[keys] Config changed, reloading...');
      try { this.loadKeys(); } catch (e) { console.error('[keys] Reload failed:', e); }
    });
  }

  validate(bearerToken: string): ApiKey | null {
    const key = this.keys.get(bearerToken);
    if (!key) return null;
    if (!key.enabled) return null;
    return key;
  }

  isModelAllowed(key: ApiKey, model: string): boolean {
    if (!key.allowedModels || key.allowedModels.includes('*')) return true;
    return key.allowedModels.includes(model);
  }

  getAllKeys(): ApiKey[] {
    return Array.from(this.keys.values());
  }

  getKeys(): ApiKey[] {
    return this.getAllKeys();
  }

  async saveKeys(keys: ApiKey[]): Promise<void> {
    const config: KeysConfig = { keys };
    const json = JSON.stringify(config, null, 2);
    writeFileSync(this.configPath, json, 'utf-8');
    this.loadKeys(); // Reload after save
    console.log(`[keys] Saved ${keys.length} API keys`);
  }
}
