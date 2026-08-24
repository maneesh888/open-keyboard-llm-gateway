import { afterEach, describe, expect, it, vi } from 'vitest';
import { localServiceLaunchSpec, ModelControlError, ModelRuntimeManager } from '../src/models/runtime.js';
import { ProviderRegistry, type GatewayProvider } from '../src/providers/types.js';

const noProviders = new ProviderRegistry();

function manager(overrides: Partial<ConstructorParameters<typeof ModelRuntimeManager>[0]> = {}) {
  return new ModelRuntimeManager({
    ollamaHost: 'http://127.0.0.1:11434',
    apfelHost: 'http://apfel.test',
    providers: noProviders,
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('bounded model runtime checks', () => {
  it('reports a loaded Ollama model without running inference', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'local-model' }] });
      if (url.endsWith('/api/ps')) return Response.json({ models: [{ model: 'local-model' }] });
      throw new Error('unexpected request');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const status = await manager().checkModel('local-model');

    expect(status).toMatchObject({
      provider: 'ollama',
      state: 'running',
      service: 'reachable',
      runtime: 'loaded',
      checkScope: 'non_inference',
      inferenceVerified: false,
      start: { supported: false },
      stop: { supported: true, action: 'unload_model', label: 'Stop model' },
    });
    expect(fetchSpy.mock.calls.map(([input]) => String(input))).toEqual([
      'http://127.0.0.1:11434/api/tags',
      'http://127.0.0.1:11434/api/ps',
    ]);
  });

  it('loads an idle local Ollama model with an empty bounded request', async () => {
    let loaded = false;
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'local-model' }] });
      if (url.endsWith('/api/ps')) return Response.json({ models: loaded ? [{ model: 'local-model' }] : [] });
      if (url.endsWith('/api/generate')) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({
          model: 'local-model',
          stream: false,
          keep_alive: '5m',
        });
        expect(JSON.parse(String(init?.body))).not.toHaveProperty('prompt');
        loaded = true;
        return Response.json({ done: true });
      }
      throw new Error('unexpected request');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const before = await manager().checkModel('local-model');
    expect(before).toMatchObject({ state: 'available', runtime: 'idle', start: { action: 'load_model' } });

    const after = await manager().startModel('local-model');
    expect(after).toMatchObject({ state: 'running', runtime: 'loaded', inferenceVerified: false });
  });

  it('starts and stops Ollama models through the trusted Docker host target', async () => {
    let loaded = false;
    const controlBodies: Array<Record<string, unknown>> = [];
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'local-model' }] });
      if (url.endsWith('/api/ps')) return Response.json({ models: loaded ? [{ model: 'local-model' }] : [] });
      if (url.endsWith('/api/generate')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        controlBodies.push(body);
        expect(body).not.toHaveProperty('prompt');
        loaded = body.keep_alive !== 0;
        return Response.json({ done: true });
      }
      throw new Error('unexpected request');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const runtime = manager({ ollamaHost: 'http://host.docker.internal:11434' });

    const idle = await runtime.checkModel('local-model');
    expect(idle).toMatchObject({ runtime: 'idle', start: { label: 'Start model' } });

    const started = await runtime.startModel('local-model');
    expect(started).toMatchObject({ runtime: 'loaded', stop: { label: 'Stop model' } });

    const stopped = await runtime.stopModel('local-model');
    expect(stopped).toMatchObject({ runtime: 'idle', start: { label: 'Start model' } });
    expect(controlBodies).toEqual([
      { model: 'local-model', stream: false, keep_alive: '5m' },
      { model: 'local-model', stream: false, keep_alive: 0 },
    ]);
  });

  it('treats Ollama cloud models as on-demand and never offers preload', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ models: [{ name: 'gpt-oss:120b-cloud' }] }));
    vi.stubGlobal('fetch', fetchSpy);

    const status = await manager().checkModel('gpt-oss:120b-cloud');

    expect(status).toMatchObject({
      state: 'available',
      runtime: 'on_demand',
      start: { supported: false },
      inferenceVerified: false,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expect(manager().startModel('gpt-oss:120b-cloud')).rejects.toMatchObject({
      code: 'start_not_supported',
    });
    await expect(manager().stopModel('gpt-oss:120b-cloud')).rejects.toMatchObject({
      code: 'stop_not_supported',
    });
  });

  it('uses Apfel health model availability without a chat request', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://apfel.test/health');
      return Response.json({ status: 'ok', model_available: false });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const status = await manager().checkModel('apple-foundationmodel');

    expect(status).toMatchObject({
      provider: 'apfel',
      state: 'unavailable',
      service: 'reachable',
      runtime: 'on_demand',
      start: { supported: false },
      inferenceVerified: false,
    });
  });

  it('fails closed when Apfel health omits explicit model availability', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'ok' })));

    const status = await manager().checkModel('apple-foundationmodel');

    expect(status).toMatchObject({
      provider: 'apfel',
      state: 'unavailable',
      service: 'reachable',
      start: { supported: false },
    });
    expect(status.message).toMatch(/did not explicitly confirm/);
  });

  it('offers service start only for explicitly enabled loopback targets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const local = await manager({
      ollamaHost: 'http://127.0.0.1:11434',
      allowLocalServiceStart: true,
    }).checkModel('local-model');
    const remote = await manager({
      ollamaHost: 'http://model-host.example:11434',
      allowLocalServiceStart: true,
    }).checkModel('local-model');

    expect(local.start).toEqual({ supported: true, action: 'start_service', label: 'Start Ollama' });
    expect(remote.start).toEqual({ supported: false });
  });

  it('never offers or executes model loading against a remote Ollama host', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'remote-model' }] });
      if (url.endsWith('/api/ps')) return Response.json({ models: [] });
      throw new Error('unexpected request');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const runtime = manager({ ollamaHost: 'http://model-host.example:11434' });

    const status = await runtime.checkModel('remote-model');

    expect(status).toMatchObject({ state: 'available', runtime: 'idle', start: { supported: false } });
    await expect(runtime.startModel('remote-model')).rejects.toMatchObject({ code: 'start_not_supported' });
    expect(fetchSpy.mock.calls.some(([input]) => String(input).endsWith('/api/generate'))).toBe(false);
  });

  it('never offers model stopping against an arbitrary remote Ollama host', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'remote-model' }] });
      if (url.endsWith('/api/ps')) return Response.json({ models: [{ name: 'remote-model' }] });
      throw new Error('unexpected request');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const runtime = manager({ ollamaHost: 'http://model-host.example:11434' });

    const status = await runtime.checkModel('remote-model');

    expect(status).toMatchObject({ runtime: 'loaded', stop: { supported: false } });
    await expect(runtime.stopModel('remote-model')).rejects.toMatchObject({ code: 'stop_not_supported' });
    expect(fetchSpy.mock.calls.some(([input]) => String(input).endsWith('/api/generate'))).toBe(false);
  });

  it('coalesces concurrent duplicate starts for the same model', async () => {
    let loaded = false;
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'local-model' }] });
      if (url.endsWith('/api/ps')) return Response.json({ models: loaded ? [{ name: 'local-model' }] : [] });
      if (url.endsWith('/api/generate')) {
        loaded = true;
        return Response.json({ done: true });
      }
      throw new Error('unexpected request');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const runtime = manager();

    const first = runtime.startModel('local-model');
    const duplicate = runtime.startModel('local-model');

    expect(duplicate).toBe(first);
    await Promise.all([first, duplicate]);
    expect(fetchSpy.mock.calls.filter(([input]) => String(input).endsWith('/api/generate'))).toHaveLength(1);
  });

  it('uses fixed no-shell launch specs without passing gateway credentials', () => {
    vi.stubEnv('CODEX_API_KEY', 'must-not-be-inherited');
    vi.stubEnv('APFEL_TOKEN', 'must-not-be-inherited');

    const ollama = localServiceLaunchSpec('ollama', new URL('http://127.0.0.1:11435'));
    const apfel = localServiceLaunchSpec('apfel', new URL('http://localhost:11436'));

    expect(ollama).toMatchObject({
      command: 'ollama',
      args: ['serve'],
      env: { OLLAMA_HOST: '127.0.0.1:11435' },
    });
    expect(apfel).toMatchObject({
      command: 'apfel',
      args: ['--serve', '--host', 'localhost', '--port', '11436'],
    });
    expect(JSON.stringify(ollama.env)).not.toContain('must-not-be-inherited');
    expect(JSON.stringify(apfel.env)).not.toContain('must-not-be-inherited');
  });

  it('reports registered on-demand providers without inference or a daemon action', async () => {
    const provider = {
      id: 'codex',
      publicModel: 'codex',
      ownedBy: 'codex',
      requiresExplicitGrant: true,
      status: () => 'configured/ready' as const,
      handlesModel: (model: string) => model === 'codex',
      execute: vi.fn(),
    } satisfies GatewayProvider;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const status = await manager({ providers: new ProviderRegistry([provider]) }).checkModel('codex');

    expect(status).toMatchObject({
      provider: 'codex',
      state: 'available',
      service: 'not_applicable',
      runtime: 'on_demand',
      start: { supported: false },
      inferenceVerified: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(manager({ providers: new ProviderRegistry([provider]) }).startModel('codex'))
      .rejects.toBeInstanceOf(ModelControlError);
  });

  it('validates and deduplicates model identifiers before checking', async () => {
    const fetchSpy = vi.fn(async () => Response.json({
      models: [{ name: 'local-model' }, { name: 'second-model' }],
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const statuses = await manager().checkModels(['local-model', 'local-model', 'second-model']);
    expect(statuses).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await expect(manager().checkModel('../bad model')).rejects.toMatchObject({ code: 'invalid_model' });
  });
});
