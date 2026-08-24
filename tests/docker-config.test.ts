import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Docker runtime configuration', () => {
  it('does not expose removed Codex credentials or runtime configuration', () => {
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf-8');
    const packageJson = readFileSync(join(process.cwd(), 'package.json'), 'utf-8');
    expect(compose).not.toContain('CODEX_API_KEY');
    expect(packageJson).not.toContain('@openai/codex');
  });
});
