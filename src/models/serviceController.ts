export type RuntimeDiagnostic = {
  code: string;
  message: string;
  steps: string[];
};

export type ControllableModelService = 'apfel';

export const MODEL_SERVICE_CONTROL_TIMEOUT_MS = 30000;

export type ModelServiceDiagnostic = RuntimeDiagnostic & { available: boolean };

export interface ModelServiceController {
  diagnostic(provider: ControllableModelService): Promise<ModelServiceDiagnostic>;
  start(provider: ControllableModelService): Promise<void>;
  stop(provider: ControllableModelService): Promise<void>;
}

export class HttpModelServiceController implements ModelServiceController {
  constructor(
    private readonly endpoint: URL,
    private readonly token: string,
  ) {}

  async diagnostic(provider: ControllableModelService): Promise<ModelServiceDiagnostic> {
    try {
      const response = await this.request('/health', 'GET', 1500);
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return controllerUnavailable();
      }
      const payload = await response.json() as { services?: Record<string, unknown> };
      const value = payload.services?.[provider];
      if (value === true) return { available: true, code: 'ready', message: 'Host control is ready.', steps: [] };
      if (typeof value === 'object' && value !== null) {
        const diagnostic = value as Partial<ModelServiceDiagnostic>;
        if (typeof diagnostic.available === 'boolean'
          && typeof diagnostic.code === 'string'
          && typeof diagnostic.message === 'string'
          && Array.isArray(diagnostic.steps)
          && diagnostic.steps.every((step) => typeof step === 'string')) {
          return diagnostic as ModelServiceDiagnostic;
        }
      }
      return controllerUnavailable('The host controller returned an invalid prerequisite status.');
    } catch {
      return controllerUnavailable();
    }
  }

  async start(provider: ControllableModelService): Promise<void> {
    await this.control(provider, 'start');
  }

  async stop(provider: ControllableModelService): Promise<void> {
    await this.control(provider, 'stop');
  }

  private async control(provider: ControllableModelService, action: 'start' | 'stop'): Promise<void> {
    const response = await this.request(
      `/services/${provider}/${action}`,
      'POST',
      MODEL_SERVICE_CONTROL_TIMEOUT_MS,
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`The host model-service controller could not ${action} ${provider}.`);
    }
    await response.body?.cancel().catch(() => undefined);
  }

  private request(path: string, method: 'GET' | 'POST', timeoutMs: number): Promise<Response> {
    return fetch(new URL(path, this.endpoint), {
      method,
      headers: { Authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
}

function controllerUnavailable(message = 'The authenticated host model-service controller is unreachable.'):
ModelServiceDiagnostic {
  return {
    available: false,
    code: 'controller_unreachable',
    message,
    steps: [
      'Start the repository model-service controller on the Mac.',
      'Verify its protected token file and modelServiceControllerUrl, then run Check again.',
    ],
  };
}
