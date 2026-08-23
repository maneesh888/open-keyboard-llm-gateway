import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Docker runtime configuration', () => {
  it('passes through the protected Codex credential name without storing a value', () => {
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf-8');
    expect(compose).toMatch(/environment:\s*\n\s*- CODEX_API_KEY/);
    expect(compose).not.toMatch(/CODEX_API_KEY\s*:\s*\S+/);
    expect(compose).not.toMatch(/CODEX_API_KEY=/);
  });
});
