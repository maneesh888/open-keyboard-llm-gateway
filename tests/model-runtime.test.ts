import { afterEach, describe, expect, it, vi } from 'vitest';
import { localServiceLaunchSpec, ModelControlError, ModelRuntimeManager } from '../src/models/runtime.js';
import type { ModelServiceController } from '../src/models/serviceController.js';

function manager(overrides: Partial<ConstructorParameters<typeof ModelRuntimeManager>[0]> = {}) {
  return new ModelRuntimeManager({
    ollamaHost: 'http://127.0.0.1:11434',
    apfelHost: 'http://apfel.test',
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

  it('loads and unloads a loopback Ollama model with exact empty bounded requests', async () => {
    let loaded = false;
    const controlBodies: Array<Record<string, unknown>> = [];
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'local-model' }] });
      if (url.endsWith('/api/ps')) return Response.json({ models: loaded ? [{ model: 'local-model' }] : [] });
      if (url.endsWith('/api/generate')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(init?.method).toBe('POST');
        expect(body).not.toHaveProperty('prompt');
        controlBodies.push(body);
        loaded = body.keep_alive !== 0;
        return Response.json({ done: true });
      }
      throw new Error('unexpected request');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const runtime = manager();
    const before = await runtime.checkModel('local-model');
    expect(before).toMatchObject({ state: 'available', runtime: 'idle', start: { action: 'load_model' } });

    const after = await runtime.startModel('local-model');
    expect(after).toMatchObject({ state: 'running', runtime: 'loaded', inferenceVerified: false });

    const stopped = await runtime.stopModel('local-model');
    expect(stopped).toMatchObject({ state: 'available', runtime: 'idle' });
    expect(controlBodies).toEqual([
      { model: 'local-model', stream: false, keep_alive: '5m' },
      { model: 'local-model', stream: false, keep_alive: 0 },
    ]);
  });

  it('treats a stale start click for an already loaded Ollama model as success', async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'local-model' }] });
      if (url.endsWith('/api/ps')) return Response.json({ models: [{ model: 'local-model' }] });
      throw new Error('an already loaded model must not receive another activation request');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const status = await manager().startModel('local-model');

    expect(status).toMatchObject({
      state: 'running',
      runtime: 'loaded',
      start: { supported: false },
      stop: { supported: true, action: 'unload_model', label: 'Stop model' },
    });
    expect(fetchSpy.mock.calls.some(([input]) => String(input).endsWith('/api/generate'))).toBe(false);
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

  it.each([
    'https://host.docker.internal:11434',
    'http://host.docker.internal:11434/nested-path',
  ])('never mutates Ollama models through non-local-safe target %s', async (ollamaHost) => {
    let loaded = false;
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'guarded-model' }] });
      if (url.endsWith('/api/ps')) return Response.json({ models: loaded ? [{ name: 'guarded-model' }] : [] });
      throw new Error('unexpected request');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const runtime = manager({ ollamaHost });

    const idle = await runtime.checkModel('guarded-model');
    expect(idle).toMatchObject({ runtime: 'idle', start: { supported: false } });
    await expect(runtime.startModel('guarded-model')).rejects.toMatchObject({ code: 'start_not_supported' });

    loaded = true;
    const running = await runtime.checkModel('guarded-model');
    expect(running).toMatchObject({ runtime: 'loaded', stop: { supported: false } });
    await expect(runtime.stopModel('guarded-model')).rejects.toMatchObject({ code: 'stop_not_supported' });
    expect(fetchSpy.mock.calls.some(([input]) => String(input).endsWith('/api/generate'))).toBe(false);
  });

  it('keeps available Apfel models start/stop read-only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'ok', model_available: true })));
    const runtime = manager();

    const status = await runtime.checkModel('apple-foundationmodel');

    expect(status).toMatchObject({ provider: 'apfel', state: 'available', start: { supported: false } });
    await expect(runtime.startModel('apple-foundationmodel')).rejects.toMatchObject({ code: 'start_not_supported' });
    await expect(runtime.stopModel('apple-foundationmodel')).rejects.toMatchObject({ code: 'stop_not_supported' });
  });

  it('starts and stops the Docker-host Apfel service through the authenticated host controller', async () => {
    let reachable = false;
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://host.docker.internal:11435/health');
      if (!reachable) throw new Error('offline');
      return Response.json({ status: 'ok', model_available: true });
    });
    const serviceController = {
      diagnostic: vi.fn(async () => ({ available: true, code: 'ready', message: 'ready', steps: [] })),
      start: vi.fn(async () => { reachable = true; }),
      stop: vi.fn(async () => { reachable = false; }),
    } satisfies ModelServiceController;
    vi.stubGlobal('fetch', fetchSpy);
    const runtime = manager({
      apfelHost: 'http://host.docker.internal:11435',
      serviceController,
    });

    const stopped = await runtime.checkModel('apple-foundationmodel');
    expect(stopped).toMatchObject({
      service: 'unreachable',
      start: { supported: true, action: 'start_service', label: 'Start Apfel' },
    });

    const started = await runtime.startModel('apple-foundationmodel');
    expect(started).toMatchObject({
      state: 'available',
      service: 'reachable',
      stop: { supported: true, action: 'stop_service', label: 'Stop Apfel' },
    });

    const stoppedAgain = await runtime.stopModel('apple-foundationmodel');
    expect(stoppedAgain).toMatchObject({
      service: 'unreachable',
      start: { supported: true, label: 'Start Apfel' },
    });
    expect(serviceController.start).toHaveBeenCalledExactlyOnceWith('apfel');
    expect(serviceController.stop).toHaveBeenCalledExactlyOnceWith('apfel');
  });

  it('classifies missing and unreachable Apfel host controllers with setup guidance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const notConfigured = await manager({
      apfelHost: 'http://host.docker.internal:11435',
    }).checkModel('apple-foundationmodel');
    expect(notConfigured).toMatchObject({
      guidance: {
        code: 'controller_not_configured',
        steps: expect.arrayContaining([
          'Run the repository model-service controller on the Mac.',
        ]),
      },
      start: { supported: false },
    });

    const serviceController = {
      diagnostic: vi.fn().mockRejectedValue(new Error('offline')),
      start: vi.fn(),
      stop: vi.fn(),
    } satisfies ModelServiceController;
    const unreachable = await manager({
      apfelHost: 'http://host.docker.internal:11435',
      serviceController,
    }).checkModel('apple-foundationmodel');
    expect(unreachable).toMatchObject({
      guidance: {
        code: 'controller_unreachable',
        steps: expect.arrayContaining([
          'Start the controller, verify its protected token file, and run Check again.',
        ]),
      },
      start: { supported: false },
    });
  });

  it('never exposes the host controller for arbitrary remote Apfel targets', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ status: 'ok', model_available: true })));
    const serviceController = {
      diagnostic: vi.fn(async () => ({ available: true, code: 'ready', message: 'ready', steps: [] })),
      start: vi.fn(),
      stop: vi.fn(),
    } satisfies ModelServiceController;
    const runtime = manager({
      apfelHost: 'http://apfel.remote.example:11435',
      serviceController,
    });

    const status = await runtime.checkModel('apple-foundationmodel');
    expect(status).toMatchObject({ start: { supported: false }, stop: { supported: false } });
    await expect(runtime.stopModel('apple-foundationmodel')).rejects.toMatchObject({ code: 'stop_not_supported' });
    expect(serviceController.diagnostic).not.toHaveBeenCalled();
    expect(serviceController.stop).not.toHaveBeenCalled();
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
    vi.stubEnv('OPENAI_API_KEY', 'must-not-be-inherited');
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
