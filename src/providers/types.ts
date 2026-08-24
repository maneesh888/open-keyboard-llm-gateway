import type { ApiKey } from '../types/index.js';
import type { ChatCompletionRequest } from '../proxy/openaiCompatibility.js';

export type ProviderHealthStatus = 'disabled' | 'configured/ready' | 'stopped' | 'unavailable';

export type RuntimeDiagnostic = {
  code: string;
  message: string;
  steps: string[];
};

export type ProviderErrorKind =
  | 'unsupported_request'
  | 'unsupported_stream'
  | 'overloaded'
  | 'timeout'
  | 'cancelled'
  | 'unavailable'
  | 'invalid_output'
  | 'execution_failed';

export class ProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind, message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type ProviderRequest = {
  method: string;
  path: string;
  body: string | undefined;
  chatRequest: ChatCompletionRequest | undefined;
  signal: AbortSignal;
};

export type ProviderResponse = {
  body: string;
  contentType: string;
};

export interface GatewayProvider {
  readonly id: string;
  readonly publicModel: string;
  readonly ownedBy: string;
  readonly requiresExplicitGrant: boolean;
  status(): ProviderHealthStatus;
  diagnostic?(): RuntimeDiagnostic | undefined;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  handlesModel(model: string): boolean;
  requestBodyLimitBytes?(path: string): number | undefined;
  execute(request: ProviderRequest): Promise<ProviderResponse>;
}

export class ProviderRegistry {
  constructor(private readonly providers: GatewayProvider[] = []) {}

  providerForModel(model: string): GatewayProvider | undefined {
    return this.providers.find((provider) => provider.handlesModel(model));
  }

  ownerForModel(model: string): string | undefined {
    return this.providers.find((provider) => provider.publicModel === model)?.ownedBy;
  }

  readyModels(): string[] {
    return this.providers
      .filter((provider) => provider.status() === 'configured/ready')
      .map((provider) => provider.publicModel);
  }

  modelsForKey(models: string[], apiKey?: ApiKey): string[] {
    const allowed = apiKey?.allowedModels || [];
    const authorizedProviderModels = this.providers
      .filter((provider) => provider.status() === 'configured/ready')
      .filter((provider) => !provider.requiresExplicitGrant || allowed.includes(provider.publicModel))
      .map((provider) => provider.publicModel);
    const providerModels = new Set(this.providers.map((provider) => provider.publicModel));
    const legacyModels = models.filter((model) => !providerModels.has(model));
    return [...new Set([...legacyModels, ...authorizedProviderModels])];
  }

  status(providerId: string): ProviderHealthStatus | undefined {
    return this.providers.find((provider) => provider.id === providerId)?.status();
  }

  requestBodyLimitBytes(path: string): number | undefined {
    const limits = this.providers
      .filter((provider) => provider.status() !== 'disabled')
      .map((provider) => provider.requestBodyLimitBytes?.(path))
      .filter((limit): limit is number => typeof limit === 'number');
    return limits.length > 0 ? Math.min(...limits) : undefined;
  }
}
