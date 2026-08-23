import { spawn } from 'node:child_process';
import type { ProviderHealthStatus, ProviderRegistry } from '../providers/types.js';

export type ModelRuntimeState = 'running' | 'available' | 'unavailable' | 'not_configured';
export type ModelServiceState = 'reachable' | 'unreachable' | 'not_applicable';
export type ModelRuntimeMode = 'loaded' | 'idle' | 'on_demand' | 'unknown' | 'not_applicable';
export type ModelStartAction = 'start_service' | 'load_model';

export type ModelRuntimeStatus = {
  model: string;
  provider: string;
  state: ModelRuntimeState;
  service: ModelServiceState;
  runtime: ModelRuntimeMode;
  checkedAt: string;
  checkScope: 'non_inference';
  inferenceVerified: false;
  message: string;
  start: {
    supported: boolean;
    action?: ModelStartAction;
    label?: string;
  };
};

export class ModelControlError extends Error {
  constructor(
    readonly code: 'invalid_model' | 'start_not_supported' | 'start_failed' | 'model_not_available',
    message: string,
  ) {
    super(message);
    this.name = 'ModelControlError';
  }
}

export interface LocalServiceLauncher {
  start(provider: 'ollama' | 'apfel', target: URL): Promise<void>;
}

export type LocalServiceLaunchSpec = {
  command: 'ollama' | 'apfel';
  args: string[];
  env: NodeJS.ProcessEnv;
};

function launcherEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const inherited = ['HOME', 'LANG', 'PATH', 'TMPDIR', 'USER'] as const;
  const env: NodeJS.ProcessEnv = { ...extra };
  for (const name of inherited) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  return env;
}

export function localServiceLaunchSpec(provider: 'ollama' | 'apfel', target: URL): LocalServiceLaunchSpec {
  const port = target.port || '11434';
  return {
    command: provider === 'ollama' ? 'ollama' : 'apfel',
    args: provider === 'ollama'
      ? ['serve']
      : ['--serve', '--host', target.hostname, '--port', port],
    env: launcherEnvironment(provider === 'ollama'
      ? { OLLAMA_HOST: `${target.hostname}:${port}` }
      : {}),
  };
}

export class ProcessLocalServiceLauncher implements LocalServiceLauncher {
  start(provider: 'ollama' | 'apfel', target: URL): Promise<void> {
    const spec = localServiceLaunchSpec(provider, target);

    return new Promise<void>((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        detached: process.platform !== 'win32',
        env: spec.env,
        shell: false,
        stdio: 'ignore',
      });
      child.once('error', () => reject(new ModelControlError(
        'start_failed',
        `The ${provider} service could not be started. Verify that its CLI is installed and available to the gateway process.`,
      )));
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
  }
}

type ModelRuntimeOptions = {
  ollamaHost: string;
  apfelHost?: string;
  providers: ProviderRegistry;
  allowLocalServiceStart?: boolean;
  launcher?: LocalServiceLauncher;
};

type ModelListPayload = { models?: Array<{ name?: string; model?: string }> };

function safeModelName(value: unknown): string {
  if (typeof value !== 'string') throw new ModelControlError('invalid_model', 'model must be a string');
  const model = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) {
    throw new ModelControlError('invalid_model', 'model must be a bounded model identifier without whitespace');
  }
  return model;
}

function modelNames(payload: ModelListPayload): Set<string> {
  return new Set((payload.models || [])
    .flatMap((entry) => [entry.name, entry.model])
    .filter((name): name is string => typeof name === 'string' && name.length > 0));
}

function statusBase(model: string, provider: string): Pick<ModelRuntimeStatus, 'model' | 'provider' | 'checkedAt' | 'checkScope' | 'inferenceVerified'> {
  return {
    model,
    provider,
    checkedAt: new Date().toISOString(),
    checkScope: 'non_inference',
    inferenceVerified: false,
  };
}

function isLoopbackTarget(target: URL): boolean {
  return target.protocol === 'http:'
    && ['', '/'].includes(target.pathname)
    && !target.username
    && !target.password
    && !target.search
    && !target.hash
    && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
}

function optionalURL(value: string | undefined): URL | undefined {
  if (!value) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

export class ModelRuntimeManager {
  private readonly ollamaTarget?: URL;
  private readonly apfelTarget?: URL;
  private readonly providers: ProviderRegistry;
  private readonly allowLocalServiceStart: boolean;
  private readonly launcher: LocalServiceLauncher;
  private readonly startInFlight = new Map<string, Promise<ModelRuntimeStatus>>();
  private readonly serviceLaunchInFlight = new Map<string, Promise<void>>();
  private ollamaTagsInFlight?: Promise<Set<string>>;
  private ollamaRunningInFlight?: Promise<Set<string> | undefined>;

  constructor(options: ModelRuntimeOptions) {
    this.ollamaTarget = optionalURL(options.ollamaHost);
    this.apfelTarget = optionalURL(options.apfelHost);
    this.providers = options.providers;
    this.allowLocalServiceStart = options.allowLocalServiceStart === true;
    this.launcher = options.launcher || new ProcessLocalServiceLauncher();
  }

  async checkModels(values: unknown[]): Promise<ModelRuntimeStatus[]> {
    const models = [...new Set(values.map(safeModelName))];
    return Promise.all(models.map((model) => this.checkModel(model)));
  }

  async checkModel(value: unknown): Promise<ModelRuntimeStatus> {
    const model = safeModelName(value);
    const provider = this.providers.providerForModel(model);
    if (provider) return this.providerStatus(model, provider.id, provider.status());
    if (model === 'apple-foundationmodel') return this.apfelStatus(model);
    return this.ollamaStatus(model);
  }

  startModel(value: unknown): Promise<ModelRuntimeStatus> {
    const model = safeModelName(value);
    const current = this.startInFlight.get(model);
    if (current) return current;

    const operation = this.startModelBounded(model).finally(() => this.startInFlight.delete(model));
    this.startInFlight.set(model, operation);
    return operation;
  }

  private providerStatus(model: string, provider: string, status: ProviderHealthStatus): ModelRuntimeStatus {
    if (status === 'disabled') {
      return {
        ...statusBase(model, provider),
        state: 'not_configured',
        service: 'not_applicable',
        runtime: 'not_applicable',
        message: `${provider} is disabled. Enable and configure the provider before using this model.`,
        start: { supported: false },
      };
    }
    if (status === 'unavailable') {
      return {
        ...statusBase(model, provider),
        state: 'unavailable',
        service: 'not_applicable',
        runtime: 'on_demand',
        message: `${provider} configuration or runtime is unavailable. No inference call was made.`,
        start: { supported: false },
      };
    }
    return {
      ...statusBase(model, provider),
      state: 'available',
      service: 'not_applicable',
      runtime: 'on_demand',
      message: `${provider} configuration and runtime are present. Live inference has not been tested.`,
      start: { supported: false },
    };
  }

  private canStartService(target: URL | undefined): boolean {
    return this.allowLocalServiceStart && Boolean(target && isLoopbackTarget(target));
  }

  private async ollamaStatus(model: string): Promise<ModelRuntimeStatus> {
    if (!this.ollamaTarget) {
      return {
        ...statusBase(model, 'ollama'),
        state: 'not_configured',
        service: 'unreachable',
        runtime: 'not_applicable',
        message: 'The Ollama target configuration is invalid.',
        start: { supported: false },
      };
    }
    let tags: Set<string>;
    try {
      tags = await this.ollamaTags();
    } catch {
      const canStart = this.canStartService(this.ollamaTarget);
      return {
        ...statusBase(model, 'ollama'),
        state: 'unavailable',
        service: 'unreachable',
        runtime: 'unknown',
        message: canStart
          ? 'Ollama is not reachable. The gateway may start the configured loopback service.'
          : 'Ollama is not reachable. Start it on the configured host; remote services cannot be started by the gateway.',
        start: canStart ? { supported: true, action: 'start_service', label: 'Start Ollama' } : { supported: false },
      };
    }

    if (!tags.has(model)) {
      return {
        ...statusBase(model, 'ollama'),
        state: 'unavailable',
        service: 'reachable',
        runtime: 'unknown',
        message: 'Ollama is reachable, but this model is not in its catalog. Pull or configure the model first.',
        start: { supported: false },
      };
    }

    if (model.endsWith(':cloud') || model.endsWith('-cloud')) {
      return {
        ...statusBase(model, 'ollama'),
        state: 'available',
        service: 'reachable',
        runtime: 'on_demand',
        message: 'The Ollama cloud model is advertised. Authentication and live inference have not been tested.',
        start: { supported: false },
      };
    }

    try {
      const running = await this.ollamaRunning();
      if (!running) throw new Error('Loaded model state unavailable');
      if (running.has(model)) {
        return {
          ...statusBase(model, 'ollama'),
          state: 'running',
          service: 'reachable',
          runtime: 'loaded',
          message: 'Ollama is reachable and the model is loaded. Live inference has not been tested.',
          start: { supported: false },
        };
      }
    } catch {
      return {
        ...statusBase(model, 'ollama'),
        state: 'available',
        service: 'reachable',
        runtime: 'unknown',
        message: 'Ollama advertises the model, but its loaded state could not be checked. Live inference has not been tested.',
        start: { supported: false },
      };
    }

    const canLoad = isLoopbackTarget(this.ollamaTarget);
    return {
      ...statusBase(model, 'ollama'),
      state: 'available',
      service: 'reachable',
      runtime: 'idle',
      message: canLoad
        ? 'Ollama advertises the local model, but it is not loaded. Loading uses an empty request and no inference tokens.'
        : 'The remote Ollama service advertises the model, but it is not loaded. It will load on the first live request.',
      start: canLoad ? { supported: true, action: 'load_model', label: 'Load model' } : { supported: false },
    };
  }

  private async apfelStatus(model: string): Promise<ModelRuntimeStatus> {
    if (!this.apfelTarget) {
      return {
        ...statusBase(model, 'apfel'),
        state: 'not_configured',
        service: 'unreachable',
        runtime: 'not_applicable',
        message: 'Apfel is not configured for this gateway.',
        start: { supported: false },
      };
    }

    try {
      const health = await this.getJSON<Record<string, unknown>>(new URL('/health', this.apfelTarget), 3000);
      if (health.model_available !== true) {
        return {
          ...statusBase(model, 'apfel'),
          state: 'unavailable',
          service: 'reachable',
          runtime: 'on_demand',
          message: health.model_available === false
            ? 'Apfel is reachable, but Apple reports that the on-device model is unavailable.'
            : 'Apfel is reachable, but health did not explicitly confirm that the on-device model is available.',
          start: { supported: false },
        };
      }
      return {
        ...statusBase(model, 'apfel'),
        state: 'available',
        service: 'reachable',
        runtime: 'on_demand',
        message: 'Apfel is reachable and reports the on-device model available. Live inference has not been tested.',
        start: { supported: false },
      };
    } catch {
      const canStart = this.canStartService(this.apfelTarget);
      return {
        ...statusBase(model, 'apfel'),
        state: 'unavailable',
        service: 'unreachable',
        runtime: 'unknown',
        message: canStart
          ? 'Apfel is not reachable. The gateway may start the configured loopback service.'
          : 'Apfel is not reachable. Start it on the configured Mac; remote services cannot be started by the gateway.',
        start: canStart ? { supported: true, action: 'start_service', label: 'Start Apfel' } : { supported: false },
      };
    }
  }

  private async startModelBounded(model: string): Promise<ModelRuntimeStatus> {
    let status = await this.checkModel(model);
    if (!status.start.supported || !status.start.action) {
      throw new ModelControlError('start_not_supported', 'This provider does not expose a safe start action.');
    }

    if (status.start.action === 'start_service') {
      const provider = status.provider as 'ollama' | 'apfel';
      const target = provider === 'ollama' ? this.ollamaTarget : this.apfelTarget;
      if (!target || !this.canStartService(target)) {
        throw new ModelControlError('start_not_supported', 'Only explicitly enabled loopback services can be started.');
      }
      await this.launchService(provider, target);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await wait(500);
        status = await this.checkModel(model);
        if (status.service === 'reachable') break;
      }
      if (status.service !== 'reachable') {
        throw new ModelControlError('start_failed', `The ${provider} service did not become reachable within the bounded startup window.`);
      }
    }

    if (status.provider === 'ollama' && status.runtime === 'idle') {
      if (!this.ollamaTarget) {
        throw new ModelControlError('start_not_supported', 'The Ollama target is not configured.');
      }
      const response = await fetch(new URL('/api/generate', this.ollamaTarget), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, keep_alive: '5m' }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new ModelControlError('start_failed', 'Ollama could not load the model within the bounded activation request.');
      }
      await response.body?.cancel().catch(() => undefined);
      return this.checkModel(model);
    }

    if (status.state === 'unavailable') {
      throw new ModelControlError('model_not_available', status.message);
    }
    return status;
  }

  private async getJSON<T>(url: URL, timeoutMs: number): Promise<T> {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('Backend status request failed');
    }
    return response.json() as Promise<T>;
  }

  private launchService(provider: 'ollama' | 'apfel', target: URL): Promise<void> {
    const current = this.serviceLaunchInFlight.get(provider);
    if (current) return current;
    const operation = this.launcher.start(provider, target)
      .finally(() => this.serviceLaunchInFlight.delete(provider));
    this.serviceLaunchInFlight.set(provider, operation);
    return operation;
  }

  private ollamaTags(): Promise<Set<string>> {
    if (!this.ollamaTarget) return Promise.reject(new Error('Ollama target is invalid'));
    if (this.ollamaTagsInFlight) return this.ollamaTagsInFlight;
    const request = this.getJSON<ModelListPayload>(new URL('/api/tags', this.ollamaTarget), 3000)
      .then(modelNames);
    this.ollamaTagsInFlight = request;
    void request.finally(() => {
      if (this.ollamaTagsInFlight === request) this.ollamaTagsInFlight = undefined;
    }).catch(() => undefined);
    return request;
  }

  private ollamaRunning(): Promise<Set<string> | undefined> {
    if (!this.ollamaTarget) return Promise.resolve(undefined);
    if (this.ollamaRunningInFlight) return this.ollamaRunningInFlight;
    const request = this.getJSON<ModelListPayload>(new URL('/api/ps', this.ollamaTarget), 3000)
      .then(modelNames)
      .catch(() => undefined);
    this.ollamaRunningInFlight = request;
    void request.finally(() => {
      if (this.ollamaRunningInFlight === request) this.ollamaRunningInFlight = undefined;
    });
    return request;
  }
}
