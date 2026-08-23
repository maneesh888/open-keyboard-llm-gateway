import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';

type PlaygroundLogic = {
  CUSTOM_MODEL_VALUE: string;
  buildModelOptions: (models: unknown[], configured?: string) => string[];
  modelSelectionForKey: (models: unknown[], configured?: string) => {
    options: string[];
    selectValue: string;
    manualValue: string;
    manualVisible: boolean;
  };
  resolveSelectedModel: (selected: string, manual: string) => string;
  catalogCountLabel: (models: unknown[]) => string;
  classifyPlaygroundError: (status: number, data: unknown, error: Error | undefined, model: string) => string;
};

const source = readFileSync(join(process.cwd(), 'public/admin/playground.js'), 'utf-8');
const context: Record<string, unknown> = {};
runInNewContext(source, context);
const logic = context.AdminPlaygroundLogic as PlaygroundLogic;

describe('Admin Playground model selection', () => {
  it('includes every discovered model plus the selected key provider alias', () => {
    expect(logic.buildModelOptions(['local-a', 'local-b', 'local-a'], 'codex'))
      .toEqual(['local-a', 'local-b', 'codex']);
  });

  it('automatically selects each key configured model without substituting the first catalog model', () => {
    expect(logic.modelSelectionForKey(['local-a', 'local-b'], 'codex')).toEqual({
      options: ['local-a', 'local-b', 'codex'],
      selectValue: 'codex',
      manualValue: '',
      manualVisible: false,
    });
    expect(logic.modelSelectionForKey(['local-a', 'local-b'], 'local-b').selectValue).toBe('local-b');
    expect(logic.modelSelectionForKey(['local-a', 'local-b']).selectValue).toBe('');
  });

  it('preserves explicit Custom/manual entry without provider substitution', () => {
    expect(logic.resolveSelectedModel(logic.CUSTOM_MODEL_VALUE, ' private-provider:model '))
      .toBe('private-provider:model');
    expect(logic.resolveSelectedModel(logic.CUSTOM_MODEL_VALUE, '   ')).toBe('');
    expect(logic.resolveSelectedModel('local-a', 'ignored-manual-value')).toBe('local-a');
  });

  it('shows only the normalized catalog count and no fake default', () => {
    expect(logic.catalogCountLabel(['local-a', 'local-a', 'local-b'])).toBe('2 models available');
    expect(logic.catalogCountLabel([])).toBe('0 models available');
  });
});

describe('Admin Playground error classification', () => {
  it('classifies structured Codex provider_unavailable before generic 503 handling', () => {
    const result = logic.classifyPlaygroundError(
      503,
      { error: { code: 'provider_unavailable', message: 'The Codex provider is unavailable.' } },
      new Error('HTTP 503'),
      'codex',
    );
    expect(result).toBe('Codex provider unavailable: verify its protected credential and runtime configuration.');
    expect(result).not.toMatch(/Ollama|Apfel/);
  });

  it('preserves Ollama/Apfel classification for genuine upstream failures', () => {
    expect(logic.classifyPlaygroundError(
      503,
      { error: { code: 'upstream_unreachable', message: 'Upstream model backend is not reachable' } },
      undefined,
      'local-a',
    )).toBe('Upstream unavailable: Ollama/Apfel backend is not reachable.');
  });
});
