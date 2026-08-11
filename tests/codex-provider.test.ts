import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server.js';
import { CodexProvider, mapChatMessagesToCodexPrompt } from '../src/providers/codex.js';
import {
  CodexRunnerError,
  codexArguments,
  codexEnvironment,
  type CodexRunInput,
  type CodexRunner,
} from '../src/providers/codexCliRunner.js';
import { ProviderError } from '../src/providers/types.js';
import type { CodexConfig } from '../src/types/index.js';

class FakeRunner implements CodexRunner {
  calls: CodexRunInput[] = [];
  available = true;

  constructor(private readonly handler: (input: CodexRunInput) => Promise<string> = async () => 'codex result') {}

  isAvailable(): boolean {
    return this.available;
  }

  async run(input: CodexRunInput): Promise<string> {
    this.calls.push(input);
    return this.handler(input);
  }
}

function codexConfig(overrides: Partial<CodexConfig> = {}): CodexConfig {
  return {
    enabled: true,
    publicModel: 'codex',
    model: 'configured-underlying-model',
    timeoutMs: 5000,
    maxConcurrent: 1,
    maxQueue: 1,
    maxInputChars: 32000,
    maxOutputChars: 16000,
    ...overrides,
  };
}

function providerRequest(overrides: Record<string, unknown> = {}) {
  const body = {
    model: 'codex',
    messages: [{ role: 'user', content: 'hello' }],
    stream: false,
    ...overrides,
  };
  return {
    method: 'POST',
    path: '/v1/chat/completions',
    body: JSON.stringify(body),
    chatRequest: body,
    signal: new AbortController().signal,
  };
}

function keysPath(): string {
  const directory = join(tmpdir(), `llm-gateway-codex-test-${Date.now()}-${Math.random()}`);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, 'keys.json');
  writeFileSync(path, JSON.stringify({
    keys: [
      { id: 'explicit', name: 'Explicit', key: 'gateway-explicit', enabled: true, allowedModels: ['codex'], rateLimit: 100, createdAt: '2026-01-01' },
      { id: 'wildcard', name: 'Wildcard', key: 'gateway-wildcard', enabled: true, allowedModels: ['*'], rateLimit: 100, createdAt: '2026-01-01' },
      { id: 'combined', name: 'Combined', key: 'gateway-combined', enabled: true, allowedModels: ['*', 'codex'], rateLimit: 100, createdAt: '2026-01-01' },
      { id: 'local', name: 'Local', key: 'gateway-local', enabled: true, allowedModels: ['local-model'], rateLimit: 100, createdAt: '2026-01-01' },
    ],
  }));
  return path;
}

function appWith(runner: CodexRunner, config = codexConfig(), apiKey: string | undefined = 'protected-test-value') {
  return createApp(
    {
      port: 0,
      ollamaHost: 'http://ollama.test',
      apfelHost: 'http://apfel.test',
      codex: config,
      logLevel: 'error',
      corsOrigins: ['*'],
    },
    keysPath(),
    undefined,
    { codexApiKey: apiKey, codexRunner: runner },
  ).app;
}

async function chat(app: ReturnType<typeof appWith>, key: string, body: Record<string, unknown>) {
  return app.request('/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Codex provider configuration and discovery', () => {
  it('uses only fixed isolation flags and a minimal process environment', () => {
    const args = codexArguments('configured-model', '/isolated/empty-work');
    expect(args).toEqual(expect.arrayContaining([
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      'read-only',
      'approval_policy="never"',
      'features.apps=false',
      'features.hooks=false',
      'features.memories=false',
      'features.multi_agent=false',
      'features.network_proxy=false',
      'features.remote_plugin=false',
      'features.shell_tool=false',
      'features.unified_exec=false',
      'features.skill_mcp_dependency_install=false',
      'shell_environment_policy.inherit="none"',
    ]));
    expect(args.at(-1)).toBe('-');

    const env = codexEnvironment('protected-value', '/isolated/codex-home');
    expect(Object.keys(env).sort()).toEqual([
      'CODEX_API_KEY',
      'CODEX_HOME',
      'CODEX_SQLITE_HOME',
      'HOME',
      'LANG',
      'NO_COLOR',
      'PATH',
    ]);
    expect(env.CODEX_API_KEY).toBe('protected-value');
    expect(JSON.stringify(args)).not.toContain('protected-value');
  });

  it('is disabled by default and performs no Codex inference for health or discovery', async () => {
    const runner = new FakeRunner();
    const app = appWith(runner, codexConfig({ enabled: false, model: undefined }));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const health = await app.request('/health');
    expect((await health.json()).codex).toBe('disabled');
    const models = await app.request('/v1/models', { headers: { Authorization: 'Bearer gateway-explicit' } });
    expect(await models.json()).toEqual({ object: 'list', data: [] });
    expect(runner.calls).toHaveLength(0);
  });

  it('keeps the reserved Codex alias unavailable when the provider is disabled', async () => {
    const runner = new FakeRunner();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const response = await chat(
      appWith(runner, codexConfig({ enabled: false, model: undefined })),
      'gateway-explicit',
      { model: 'codex', messages: [{ role: 'user', content: 'hello' }], stream: false },
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('provider_unavailable');
    expect(runner.calls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('distinguishes unavailable from configured/ready without a paid call', async () => {
    const runner = new FakeRunner();
    const unavailable = appWith(runner, codexConfig(), '');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect((await (await unavailable.request('/health')).json()).codex).toBe('unavailable');

    const ready = appWith(runner);
    expect((await (await ready.request('/health')).json()).codex).toBe('configured/ready');
    expect(runner.calls).toHaveLength(0);
  });

  it('discovers the Codex alias with owned_by only for explicitly granted keys', async () => {
    const app = appWith(new FakeRunner());
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ models: [{ name: 'local-model' }] }), { status: 200 }),
    )));

    const explicit = await app.request('/v1/models', { headers: { Authorization: 'Bearer gateway-explicit' } });
    expect(await explicit.json()).toEqual({
      object: 'list',
      data: [{ id: 'codex', object: 'model', created: 0, owned_by: 'codex' }],
    });

    const wildcard = await app.request('/v1/models', { headers: { Authorization: 'Bearer gateway-wildcard' } });
    const wildcardModels = (await wildcard.json()).data.map((model: { id: string }) => model.id);
    expect(wildcardModels).toEqual(expect.arrayContaining(['apple-foundationmodel', 'local-model']));
    expect(wildcardModels).not.toContain('codex');

    const combined = await app.request('/v1/models', { headers: { Authorization: 'Bearer gateway-combined' } });
    expect((await combined.json()).data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'codex', owned_by: 'codex' }),
      expect.objectContaining({ id: 'local-model', owned_by: 'ollama' }),
    ]));
  });
});

describe('Codex request routing and compatibility', () => {
  it('requires an explicit per-key grant even when the key has a wildcard', async () => {
    const runner = new FakeRunner();
    const response = await chat(appWith(runner), 'gateway-wildcard', {
      model: 'codex', messages: [{ role: 'user', content: 'hello' }], stream: false,
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('model_not_allowed');
    expect(runner.calls).toHaveLength(0);
  });

  it('routes the public alias to the configured underlying model and wraps a valid OpenAI response', async () => {
    const runner = new FakeRunner(async () => 'final answer');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const response = await chat(appWith(runner), 'gateway-explicit', {
      model: 'codex',
      messages: [{ role: 'system', content: 'Be concise.' }, { role: 'user', content: 'Hello.' }],
      stream: false,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      object: 'chat.completion',
      model: 'codex',
      choices: [{ index: 0, message: { role: 'assistant', content: 'final answer' }, finish_reason: 'stop' }],
    });
    expect(runner.calls[0].model).toBe('configured-underlying-model');
    expect(runner.calls[0].prompt).toContain(JSON.stringify([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hello.' },
    ]));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps supported roles as inert JSON message data', () => {
    const prompt = mapChatMessagesToCodexPrompt({
      model: 'codex',
      messages: [
        { role: 'developer', content: 'Return a sentence.' },
        { role: 'assistant', content: 'Earlier answer.' },
        { role: 'user', content: 'New question.' },
      ],
    }, 10000);
    expect(prompt).toContain('untrusted message data');
    expect(prompt).toContain('"role":"developer"');
    expect(prompt).toContain('"content":"New question."');
  });

  it('preserves structured OpenKeyboard operation normalization', async () => {
    const runner = new FakeRunner(async () => JSON.stringify({
      operation: 'rewrite',
      results: [{ id: 'rewrite-1', type: 'suggestion', title: 'Rewrite', text: 'Clear text.', replacement: 'Clear text.' }],
    }));
    const response = await chat(appWith(runner), 'gateway-explicit', {
      model: 'codex',
      operation: 'rewrite',
      input_text: 'make clear',
      messages: [{ role: 'user', content: 'Rewrite clearly.' }],
      stream: false,
    });
    expect(response.status).toBe(200);
    const content = JSON.parse((await response.json()).choices[0].message.content);
    expect(content).toEqual({
      operation: 'rewrite',
      results: [{ id: 'rewrite-1', type: 'suggestion', title: 'Rewrite', text: 'Clear text.', replacement: 'Clear text.' }],
    });
    expect(runner.calls[0].prompt).toContain('Requested operation: rewrite.');
    expect(runner.calls[0].prompt).toContain('operation=rewrite');
  });

  it('rejects streaming and unsupported generation fields before execution', async () => {
    const runner = new FakeRunner();
    const app = appWith(runner);
    const stream = await chat(app, 'gateway-explicit', {
      model: 'codex', messages: [{ role: 'user', content: 'hello' }], stream: true,
    });
    expect(stream.status).toBe(400);
    expect((await stream.json()).error.code).toBe('stream_not_supported_for_provider');

    const parameter = await chat(app, 'gateway-explicit', {
      model: 'codex', messages: [{ role: 'user', content: 'hello' }], temperature: 0.2,
    });
    expect(parameter.status).toBe(400);
    expect((await parameter.json()).error.code).toBe('unsupported_parameter');
    expect(runner.calls).toHaveLength(0);
  });

  it('rejects non-text messages and oversized input', async () => {
    const runner = new FakeRunner();
    const app = appWith(runner, codexConfig({ maxInputChars: 300 }));
    const multimodal = await chat(app, 'gateway-explicit', {
      model: 'codex', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    });
    expect(multimodal.status).toBe(400);
    expect((await multimodal.json()).error.code).toBe('unsupported_parameter');

    const oversized = await chat(app, 'gateway-explicit', {
      model: 'codex', messages: [{ role: 'user', content: 'x'.repeat(1000) }],
    });
    expect(oversized.status).toBe(400);
    expect((await oversized.json()).error.code).toBe('unsupported_parameter');
    expect(runner.calls).toHaveLength(0);
  });

  it('continues to route Ollama and Apfel models without invoking Codex', async () => {
    const runner = new FakeRunner();
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'chatcmpl-local', object: 'chat.completion', created: 1, model: 'local-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'local' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
    const response = await chat(appWith(runner), 'gateway-local', {
      model: 'local-model', messages: [{ role: 'user', content: 'hello' }], stream: false,
    });
    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe('http://ollama.test/v1/chat/completions');
    expect(runner.calls).toHaveLength(0);
  });
});

describe('Codex failure, cancellation, and capacity controls', () => {
  it.each([
    { output: '', status: 502, code: 'invalid_upstream_response' },
    { output: 'x'.repeat(501), status: 502, code: 'invalid_upstream_response' },
  ])('rejects malformed or bounded output', async ({ output, status, code }) => {
    const runner = new FakeRunner(async () => output);
    const response = await chat(appWith(runner, codexConfig({ maxOutputChars: 500 })), 'gateway-explicit', {
      model: 'codex', messages: [{ role: 'user', content: 'hello' }], stream: false,
    });
    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  });

  it('normalizes malformed runner event output as an invalid upstream response', async () => {
    const runner = new FakeRunner(async () => {
      throw new CodexRunnerError('invalid_output');
    });
    const response = await chat(appWith(runner), 'gateway-explicit', {
      model: 'codex', messages: [{ role: 'user', content: 'hello' }], stream: false,
    });
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('invalid_upstream_response');
  });

  it('times out and propagates cancellation to runner cleanup', async () => {
    let cleaned = false;
    const runner = new FakeRunner((input) => new Promise((_resolve, reject) => {
      input.signal.addEventListener('abort', () => {
        cleaned = true;
        reject(new CodexRunnerError('cancelled'));
      }, { once: true });
    }));
    const provider = new CodexProvider(codexConfig({ timeoutMs: 20 }), { apiKey: 'protected-test-value', runner });
    await expect(provider.execute(providerRequest())).rejects.toMatchObject({ kind: 'timeout' });
    expect(cleaned).toBe(true);
  });

  it('propagates client cancellation to runner cleanup', async () => {
    let cleaned = false;
    const runner = new FakeRunner((input) => new Promise((_resolve, reject) => {
      input.signal.addEventListener('abort', () => {
        cleaned = true;
        reject(new CodexRunnerError('cancelled'));
      }, { once: true });
    }));
    const controller = new AbortController();
    const provider = new CodexProvider(codexConfig(), { apiKey: 'protected-test-value', runner });
    const pending = provider.execute({ ...providerRequest(), signal: controller.signal });
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });
    expect(cleaned).toBe(true);
  });

  it('bounds concurrency and rejects deterministic queue saturation', async () => {
    const releases: Array<(value: string) => void> = [];
    const runner = new FakeRunner(() => new Promise<string>((resolve) => releases.push(resolve)));
    const provider = new CodexProvider(codexConfig({ maxConcurrent: 1, maxQueue: 1 }), {
      apiKey: 'protected-test-value',
      runner,
    });

    const first = provider.execute(providerRequest());
    await vi.waitFor(() => expect(runner.calls).toHaveLength(1));
    const second = provider.execute(providerRequest({ messages: [{ role: 'user', content: 'second' }] }));
    const third = provider.execute(providerRequest({ messages: [{ role: 'user', content: 'third' }] }));
    await expect(third).rejects.toMatchObject({ kind: 'overloaded' });

    releases.shift()!('first');
    await expect(first).resolves.toBeDefined();
    await vi.waitFor(() => expect(runner.calls).toHaveLength(2));
    releases.shift()!('second');
    await expect(second).resolves.toBeDefined();
  });

  it('normalizes failures without logging credentials, prompts, or raw output', async () => {
    const privatePrompt = 'private-prompt-marker';
    const privateCredential = 'private-credential-marker';
    const rawOutput = 'raw-response-marker';
    const runner = new FakeRunner(async () => {
      throw new Error(`${privatePrompt} ${privateCredential} ${rawOutput}`);
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await chat(appWith(runner, codexConfig(), privateCredential), 'gateway-explicit', {
      model: 'codex', messages: [{ role: 'user', content: privatePrompt }], stream: false,
    });
    const body = JSON.stringify(await response.json());
    const logs = [...log.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(response.status).toBe(502);
    expect(body).not.toContain(privatePrompt);
    expect(body).not.toContain(privateCredential);
    expect(body).not.toContain(rawOutput);
    expect(logs).not.toContain(privatePrompt);
    expect(logs).not.toContain(privateCredential);
    expect(logs).not.toContain(rawOutput);
  });

  it('maps unavailable runner state without exposing configuration details', async () => {
    const runner = new FakeRunner();
    runner.available = false;
    const response = await chat(appWith(runner), 'gateway-explicit', {
      model: 'codex', messages: [{ role: 'user', content: 'hello' }], stream: false,
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatchObject({ code: 'provider_unavailable' });
  });
});
