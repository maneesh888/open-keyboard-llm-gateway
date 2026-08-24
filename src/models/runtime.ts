import { spawn } from 'node:child_process';
import type { ModelServiceController, ModelServiceDiagnostic, RuntimeDiagnostic } from './serviceController.js';

export type ModelRuntimeState = 'running' | 'available' | 'unavailable' | 'not_configured';
export type ModelServiceState = 'reachable' | 'unreachable' | 'not_applicable';
export type ModelRuntimeMode = 'loaded' | 'idle' | 'on_demand' | 'unknown' | 'not_applicable';
export type ModelStartAction = 'start_service' | 'load_model';
export type ModelStopAction = 'unload_model' | 'stop_service';

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
  guidance?: RuntimeDiagnostic;
  start: {
    supported: boolean;
    action?: ModelStartAction;
    label?: string;
  };
  stop?: {
    supported: boolean;
    action?: ModelStopAction;
    label?: string;
  };
};

export class ModelControlError extends Error {
  constructor(
    readonly code: 'invalid_model' | 'start_not_supported' | 'start_failed' | 'stop_not_supported' | 'stop_failed' | 'model_not_available',
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
  allowLocalServiceStart?: boolean;
  launcher?: LocalServiceLauncher;
  serviceController?: ModelServiceController;
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

function isDockerHostTarget(target: URL): boolean {
  return target.protocol === 'http:'
    && ['', '/'].includes(target.pathname)
    && !target.username
    && !target.password
    && !target.search
    && !target.hash
    && target.hostname === 'host.docker.internal';
}

function canControlOllamaModel(target: URL | undefined): boolean {
  return Boolean(target && (isLoopbackTarget(target) || isDockerHostTarget(target)));
}

function canControlApfelService(target: URL | undefined): boolean {
  return Boolean(target && (isLoopbackTarget(target) || isDockerHostTarget(target)));
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
  private readonly allowLocalServiceStart: boolean;
  private readonly launcher: LocalServiceLauncher;
  private readonly serviceController?: ModelServiceController;
  private readonly startInFlight = new Map<string, Promise<ModelRuntimeStatus>>();
  private readonly stopInFlight = new Map<string, Promise<ModelRuntimeStatus>>();
  private readonly serviceLaunchInFlight = new Map<string, Promise<void>>();
  private ollamaTagsInFlight?: Promise<Set<string>>;
  private ollamaRunningInFlight?: Promise<Set<string> | undefined>;

  constructor(options: ModelRuntimeOptions) {
    this.ollamaTarget = optionalURL(options.ollamaHost);
    this.apfelTarget = optionalURL(options.apfelHost);
    this.allowLocalServiceStart = options.allowLocalServiceStart === true;
    this.launcher = options.launcher || new ProcessLocalServiceLauncher();
    this.serviceController = options.serviceController;
  }

  async checkModels(values: unknown[]): Promise<ModelRuntimeStatus[]> {
    const models = [...new Set(values.map(safeModelName))];
    return Promise.all(models.map((model) => this.checkModel(model)));
  }

  async checkModel(value: unknown): Promise<ModelRuntimeStatus> {
    const model = safeModelName(value);
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

  stopModel(value: unknown): Promise<ModelRuntimeStatus> {
    const model = safeModelName(value);
    const current = this.stopInFlight.get(model);
    if (current) return current;

    const operation = this.stopModelBounded(model).finally(() => this.stopInFlight.delete(model));
    this.stopInFlight.set(model, operation);
    return operation;
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
        const canUnload = canControlOllamaModel(this.ollamaTarget);
        return {
          ...statusBase(model, 'ollama'),
          state: 'running',
          service: 'reachable',
          runtime: 'loaded',
          message: 'Ollama is reachable and the model is loaded. Live inference has not been tested.',
          start: { supported: false },
          stop: canUnload ? { supported: true, action: 'unload_model', label: 'Stop model' } : { supported: false },
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

    const canLoad = canControlOllamaModel(this.ollamaTarget);
    return {
      ...statusBase(model, 'ollama'),
      state: 'available',
      service: 'reachable',
      runtime: 'idle',
      message: canLoad
        ? 'Ollama advertises the local model, but it is not loaded. Starting it uses an empty request with no prompt.'
        : 'The remote Ollama service advertises the model, but it is not loaded. It will load on the first live request.',
      start: canLoad ? { supported: true, action: 'load_model', label: 'Start model' } : { supported: false },
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
      const serviceControl = await this.apfelServiceDiagnostic();
      const canStop = serviceControl?.available === true;
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
          stop: canStop ? { supported: true, action: 'stop_service', label: 'Stop Apfel' } : { supported: false },
          guidance: serviceControl?.available === false ? serviceControl : undefined,
        };
      }
      return {
        ...statusBase(model, 'apfel'),
        state: 'available',
        service: 'reachable',
        runtime: 'on_demand',
        message: 'Apfel is reachable and reports the on-device model available. Live inference has not been tested.',
        start: { supported: false },
        stop: canStop ? { supported: true, action: 'stop_service', label: 'Stop Apfel' } : { supported: false },
        guidance: serviceControl?.available === false ? serviceControl : undefined,
      };
    } catch {
      const serviceControl = await this.apfelServiceDiagnostic();
      const canStart = this.canStartService(this.apfelTarget) || serviceControl?.available === true;
      return {
        ...statusBase(model, 'apfel'),
        state: 'unavailable',
        service: 'unreachable',
        runtime: 'unknown',
        message: canStart
          ? 'Apfel is not reachable. The gateway may start the configured host service.'
          : serviceControl?.message || 'Apfel is not reachable. Start it on the configured Mac; remote services cannot be started by the gateway.',
        start: canStart ? { supported: true, action: 'start_service', label: 'Start Apfel' } : { supported: false },
        guidance: serviceControl?.available === false ? serviceControl : undefined,
      };
    }
  }

  private async startModelBounded(model: string): Promise<ModelRuntimeStatus> {
    let status = await this.checkModel(model);
    if (status.provider === 'ollama' && status.state === 'running' && status.runtime === 'loaded') {
      return status;
    }
    if (!status.start.supported || !status.start.action) {
      throw new ModelControlError('start_not_supported', 'This provider does not expose a safe start action.');
    }

    if (status.start.action === 'start_service') {
      const provider = status.provider as 'ollama' | 'apfel';
      const target = provider === 'ollama' ? this.ollamaTarget : this.apfelTarget;
      if (!target) {
        throw new ModelControlError('start_not_supported', 'The provider target is not configured.');
      }
      if (provider === 'apfel' && (await this.apfelServiceDiagnostic())?.available === true) {
        try {
          await this.serviceController!.start('apfel');
        } catch {
          throw new ModelControlError('start_failed', 'The authenticated host controller could not start Apfel.');
        }
      } else {
        if (!this.canStartService(target)) {
          throw new ModelControlError('start_not_supported', 'Only explicitly enabled loopback services can be started.');
        }
        await this.launchService(provider, target);
      }
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

  private async stopModelBounded(model: string): Promise<ModelRuntimeStatus> {
    const status = await this.checkModel(model);
    if (!status.stop?.supported || !status.stop.action) {
      throw new ModelControlError('stop_not_supported', 'This provider does not expose a safe stop action.');
    }

    if (status.stop.action === 'stop_service') {
      if (status.provider !== 'apfel' || (await this.apfelServiceDiagnostic())?.available !== true) {
        throw new ModelControlError('stop_not_supported', 'Apfel service stop requires the authenticated local host controller.');
      }
      try {
        await this.serviceController!.stop('apfel');
      } catch {
        throw new ModelControlError('stop_failed', 'The authenticated host controller could not stop Apfel.');
      }
      let stopped = await this.checkModel(model);
      for (let attempt = 0; attempt < 8 && stopped.service === 'reachable'; attempt += 1) {
        await wait(500);
        stopped = await this.checkModel(model);
      }
      if (stopped.service === 'reachable') {
        throw new ModelControlError('stop_failed', 'Apfel remained reachable after the bounded stop window.');
      }
      return stopped;
    }

    if (status.stop.action !== 'unload_model') {
      throw new ModelControlError('stop_not_supported', 'This provider does not expose a safe stop action.');
    }
    if (status.provider !== 'ollama' || status.runtime !== 'loaded' || !canControlOllamaModel(this.ollamaTarget)) {
      throw new ModelControlError('stop_not_supported', 'Only local loaded Ollama models can be stopped.');
    }

    const response = await fetch(new URL('/api/generate', this.ollamaTarget!), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false, keep_alive: 0 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ModelControlError('stop_failed', 'Ollama could not unload the model within the bounded stop request.');
    }
    await response.body?.cancel().catch(() => undefined);
    const stopped = await this.checkModel(model);
    if (stopped.runtime === 'loaded') {
      throw new ModelControlError('stop_failed', 'Ollama still reports the model as loaded after the bounded stop request.');
    }
    return stopped;
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

  private async apfelServiceDiagnostic(): Promise<ModelServiceDiagnostic | undefined> {
    if (!canControlApfelService(this.apfelTarget)) return undefined;
    if (!this.serviceController) {
      return {
        available: false,
        code: 'controller_not_configured',
        message: 'Apfel host service control is not configured.',
        steps: [
          'Run the repository model-service controller on the Mac.',
          'Configure modelServiceControllerUrl and the shared protected token file, then run Check again.',
        ],
      };
    }
    try {
      return await this.serviceController.diagnostic('apfel');
    } catch {
      return {
        available: false,
        code: 'controller_unreachable',
        message: 'The authenticated host model-service controller is unreachable.',
        steps: ['Start the controller, verify its protected token file, and run Check again.'],
      };
    }
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
