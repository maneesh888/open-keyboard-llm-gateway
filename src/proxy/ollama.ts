import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { Context } from 'hono';
import type { ApiKey } from '../types/index.js';
import { errorResponse } from '../lib/errors.js';
import {
  applyChatCompletionCompatibilityProfile,
  parseChatCompletionRequest,
  prepareChatCompletionStream,
  requestsJsonSchemaResponse,
  validateChatCompletionResponse,
  type ChatCompletionRequest,
} from './openaiCompatibility.js';

type OpenAIRequestBody = Record<string, unknown>;
type EffortTarget = 'chat' | 'responses';

type OpenAIModel = {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
};

export class UpstreamResponseError extends Error {
  constructor(message: string, readonly upstreamStatus: number) {
    super(message);
    this.name = 'UpstreamResponseError';
  }
}

export class OllamaProxy {
  private host: string;
  private apfelHost?: string;
  private knownModelsPath: string;

  constructor(
    host: string,
    apfelHost?: string,
    knownModelsPath = './config/known-models.json',
  ) {
    this.host = host.replace(/\/$/, '');
    this.apfelHost = apfelHost?.replace(/\/$/, '');
    this.knownModelsPath = knownModelsPath;
  }

  private loadKnownModels(): string[] {
    try {
      if (!existsSync(this.knownModelsPath)) return [];
      const data = JSON.parse(readFileSync(this.knownModelsPath, 'utf-8')) as { models?: string[] };
      return data.models || [];
    } catch { return []; }
  }

  private rememberModel(model: string): void {
    try {
      const known = new Set(this.loadKnownModels());
      if (known.has(model)) return;
      known.add(model);
      writeFileSync(this.knownModelsPath, JSON.stringify({ models: [...known].sort() }, null, 2), 'utf-8');
    } catch (e) {
      console.error('[gateway] Failed to remember model:', e instanceof Error ? e.message : e);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch { return false; }
  }

  async listModels(): Promise<string[]> {
    const tagsRes = await fetch(`${this.host}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!tagsRes.ok) {
      throw new UpstreamResponseError(`Ollama model list failed (${tagsRes.status})`, tagsRes.status);
    }

    let tags: { models?: Array<{ name?: string; model?: string }> };
    try {
      tags = await tagsRes.json() as { models?: Array<{ name?: string; model?: string }> };
    } catch {
      throw new UpstreamResponseError('Ollama model list returned invalid JSON', tagsRes.status);
    }
    const models = new Set<string>(this.loadKnownModels());
    for (const model of tags.models || []) {
      const name = model.name || model.model;
      if (name) models.add(name);
    }

    if (this.apfelHost) {
      try {
        const apfelRes = await fetch(`${this.apfelHost}/v1/models`, { signal: AbortSignal.timeout(5000) });
        if (apfelRes.ok) {
          const apfel = await apfelRes.json() as { data?: Array<{ id?: string }> };
          const apfelModelIds = new Set((apfel.data || []).map((model) => model.id).filter(Boolean));
          if (!apfelModelIds.size || apfelModelIds.has('apple-foundationmodel')) {
            models.add('apple-foundationmodel');
          }
        }
      } catch {}
    }

    return [...models].sort((a, b) => a.localeCompare(b));
  }

  private uniqueModels(models: string[]): string[] {
    return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
  }

  private keyScopedModels(apiKey?: ApiKey): string[] | null {
    const configuredModel = apiKey?.modelConfig?.model?.trim();
    const allowedModels = this.uniqueModels(apiKey?.allowedModels || []);

    if (allowedModels.length > 0 && !allowedModels.includes('*')) {
      return allowedModels;
    }

    return configuredModel ? [configuredModel] : null;
  }

  private modelOwner(model: string): string {
    return model === 'apple-foundationmodel' ? 'apfel' : 'ollama';
  }

  private openAIModelsResponse(models: string[]): { object: 'list'; data: OpenAIModel[] } {
    return {
      object: 'list',
      data: this.uniqueModels(models).map((model) => ({
        id: model,
        object: 'model',
        created: 0,
        owned_by: this.modelOwner(model),
      })),
    };
  }

  private async publicModelsForKey(apiKey?: ApiKey): Promise<string[]> {
    return this.keyScopedModels(apiKey) || await this.listModels();
  }

  private async handlePublicModels(c: Context): Promise<Response> {
    try {
      const models = await this.publicModelsForKey(c.get('apiKey') as ApiKey | undefined);
      return c.json(this.openAIModelsResponse(models));
    } catch (e: any) {
      if (e instanceof UpstreamResponseError) {
        return errorResponse(c, 502, 'upstream_error', 'Upstream model request failed.', {
          upstreamStatus: e.upstreamStatus,
        });
      }
      if (e?.name === 'TimeoutError') {
        return errorResponse(c, 504, 'upstream_timeout', 'Ollama request timed out');
      }
      return errorResponse(c, 503, 'upstream_unreachable', 'Upstream model backend is not reachable');
    }
  }
  private hasOwnField(value: Record<string, unknown>, field: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, field);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private parseJSONRequestBody(body?: string): OpenAIRequestBody | undefined {
    if (!body) return undefined;
    try {
      const parsed = JSON.parse(body) as unknown;
      return this.isRecord(parsed) ? parsed as OpenAIRequestBody : undefined;
    } catch {
      return undefined;
    }
  }

  private targetHostForModel(model?: string): string {
    if (this.apfelHost && model === 'apple-foundationmodel') {
      return this.apfelHost;
    }
    return this.host;
  }

  private effortTargetForPath(path: string): EffortTarget | undefined {
    if (path === '/v1/chat/completions') return 'chat';
    if (path === '/v1/responses') return 'responses';
    return undefined;
  }

  private hasCallerEffortSetting(parsed: Record<string, unknown>): boolean {
    if (this.hasOwnField(parsed, 'reasoning_effort')) return true;
    if (this.isRecord(parsed.reasoning) && this.hasOwnField(parsed.reasoning, 'effort')) return true;
    return this.isRecord(parsed.chat_template_kwargs) && this.hasOwnField(parsed.chat_template_kwargs, 'reasoning_effort');
  }

  private applyConfiguredEffort(body: string | undefined, path: string, apiKey?: ApiKey): string | undefined {
    const effort = apiKey?.modelConfig?.effort;
    const target = this.effortTargetForPath(path);
    if (!body || !effort || !target) return body;

    const parsed = this.parseJSONRequestBody(body);
    if (!parsed || this.hasCallerEffortSetting(parsed)) return body;

    if (target === 'responses') {
      const reasoning = this.isRecord(parsed.reasoning) ? parsed.reasoning : {};
      parsed.reasoning = { ...reasoning, effort };
    } else {
      parsed.reasoning_effort = effort;
    }

    return JSON.stringify(parsed);
  }

  async forward(c: Context): Promise<Response> {
    // Read body first so model checks can gate before any network call
    const body = c.req.method !== 'GET' ? await c.req.text() : undefined;

    if (c.req.method === 'GET' && c.req.path === '/v1/models') {
      return this.handlePublicModels(c);
    }

    const isChatCompletions = c.req.path === '/v1/chat/completions';
    if (isChatCompletions && c.req.method !== 'POST') {
      return errorResponse(c, 405, 'invalid_request', 'Chat Completions requires POST.');
    }

    let chatRequest: ChatCompletionRequest | undefined;
    if (isChatCompletions) {
      const contentType = c.req.header('Content-Type') || '';
      if (contentType && !contentType.toLowerCase().includes('application/json')) {
        return errorResponse(c, 415, 'invalid_request', 'Content-Type must be application/json.');
      }
      const compatibility = parseChatCompletionRequest(body);
      if (!compatibility.ok) {
        return errorResponse(c, 400, 'invalid_request', compatibility.message);
      }
      chatRequest = compatibility.value;
    }

    // Extract the model for routing and policy checks. The client owns message semantics.
    let model: string | undefined;
    let outboundBody = body;
    if (body) {
      const parsed = chatRequest || this.parseJSONRequestBody(body);
      if (parsed?.model && typeof parsed.model === 'string') {
        model = parsed.model;
        c.set('model', model);
      }
    }

    const apiKey = c.get('apiKey') as ApiKey | undefined;
    outboundBody = this.applyConfiguredEffort(outboundBody, c.req.path, apiKey);

    // Enforce per-key model allowlist (inline — no KeyManager dependency needed)
    if (model && apiKey) {
      const allowed = apiKey.allowedModels as string[] | undefined;
      const explicitlyGranted = allowed?.includes(model) === true;
      if (allowed && !allowed.includes('*') && !explicitlyGranted) {
        return errorResponse(c, 403, 'model_not_allowed', `Model '${model}' is not allowed for this API key`);
      }
    }

    if (isChatCompletions
      && apiKey?.compatibilityProfile === 'universal-ai-connector'
      && chatRequest
      && requestsJsonSchemaResponse(chatRequest)) {
      return errorResponse(
        c,
        400,
        'unsupported_response_format',
        'JSON Schema structured output is not supported by this compatibility profile.',
      );
    }

    // Build target URL — treat URL construction errors as a config problem (503)
    let url: URL;
    try {
      url = new URL(this.targetHostForModel(model) + c.req.path);
    } catch {
      return errorResponse(c, 503, 'upstream_unreachable', 'Upstream model backend is not reachable');
    }

    const headers = new Headers();
    headers.set('Content-Type', c.req.header('Content-Type') || 'application/json');
    const upstreamController = new AbortController();
    const timeoutSignal = AbortSignal.timeout(300000);
    const upstreamSignal = AbortSignal.any([c.req.raw.signal, timeoutSignal, upstreamController.signal]);

    try {
      const res = await fetch(url.toString(), {
        method: c.req.method,
        headers,
        body: outboundBody,
        signal: upstreamSignal,
      });

      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return errorResponse(c, 502, 'upstream_error', 'Upstream model request failed.', {
          upstreamStatus: res.status,
        });
      }

      const contentType = res.headers.get('content-type') || '';
      const streamRequested = chatRequest?.stream === true;
      if (streamRequested) {
        if (!contentType.toLowerCase().includes('text/event-stream')) {
          upstreamController.abort('Unsupported upstream streaming content type');
          await res.body?.cancel().catch(() => undefined);
          return errorResponse(c, 502, 'invalid_stream', 'The upstream did not return an OpenAI-compatible SSE stream.');
        }
        const prepared = await prepareChatCompletionStream(
          res.body,
          upstreamController,
          apiKey?.compatibilityProfile,
        );
        if (!prepared.ok) {
          return errorResponse(c, 502, 'invalid_stream', 'The upstream emitted an invalid Chat Completions stream.');
        }
        if (model) this.rememberModel(model);
        return new Response(prepared.value.stream, {
          status: res.status,
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        });
      }

      if (!isChatCompletions && (contentType.includes('text/event-stream') || contentType.includes('ndjson'))) {
        if (model) this.rememberModel(model);
        return new Response(res.body, {
          status: res.status,
          headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        });
      }

      if (isChatCompletions && (contentType.includes('text/event-stream') || contentType.includes('ndjson'))) {
        upstreamController.abort('Unexpected upstream streaming response');
        await res.body?.cancel().catch(() => undefined);
        return errorResponse(c, 502, 'invalid_upstream_response', 'The upstream returned an unexpected streaming response.');
      }

      const rawResponseBody = await res.text();
      let responseBody = rawResponseBody;
      if (isChatCompletions) {
        const compatibility = validateChatCompletionResponse(rawResponseBody);
        if (!compatibility.ok) {
          return errorResponse(c, 502, 'invalid_upstream_response', compatibility.message);
        }
      }
      if (isChatCompletions) {
        const profiled = applyChatCompletionCompatibilityProfile(responseBody, apiKey?.compatibilityProfile);
        if (!profiled.ok) {
          return errorResponse(c, 502, 'invalid_upstream_response', profiled.message);
        }
        responseBody = profiled.value;
      }
      if (model) this.rememberModel(model);
      return new Response(responseBody, {
        status: res.status,
        headers: { 'Content-Type': isChatCompletions ? 'application/json' : contentType },
      });
    } catch (e: any) {
      if (e?.name === 'TimeoutError' || (timeoutSignal.aborted && timeoutSignal.reason?.name === 'TimeoutError')) {
        return errorResponse(c, 504, 'upstream_timeout', 'Ollama request timed out');
      }
      if (c.req.raw.signal.aborted) {
        return errorResponse(c, 408, 'request_cancelled', 'The client cancelled the request.');
      }
      return errorResponse(c, 503, 'upstream_unreachable', 'Upstream model backend is not reachable');
    }
  }
}
