import type { Context } from 'hono';
import type { ApiKey } from '../types/index.js';

type OpenAIModel = {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
};

export class OllamaProxy {
  private host: string;
  private apfelHost?: string;

  constructor(host: string, apfelHost?: string) {
    this.host = host.replace(/\/$/, '');
    this.apfelHost = apfelHost?.replace(/\/$/, '');
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.host}/api/tags`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch { return false; }
  }

  async listModels(): Promise<string[]> {
    const [tagsResult, psResult] = await Promise.allSettled([
      fetch(`${this.host}/api/tags`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${this.host}/api/ps`, { signal: AbortSignal.timeout(5000) }),
    ]);

    if (tagsResult.status === 'rejected' || !tagsResult.value.ok) {
      const status = tagsResult.status === 'fulfilled' ? tagsResult.value.status : 'network';
      throw new Error(`Ollama model list failed (${status})`);
    }

    const tags = await tagsResult.value.json() as { models?: Array<{ name?: string; model?: string; remote_model?: string; remote_host?: string }> };
    let loaded = new Set<string>();
    if (psResult.status === 'fulfilled' && psResult.value.ok) {
      const ps = await psResult.value.json() as { models?: Array<{ name?: string; model?: string }> };
      loaded = new Set((ps.models || []).map((m) => m.name || m.model).filter((name): name is string => Boolean(name)));
    }

    const models = new Set<string>();
    for (const model of tags.models || []) {
      const name = model.name || model.model;
      if (!name) continue;
      const isCloud = Boolean(model.remote_model || model.remote_host || name.endsWith('-cloud'));
      if (isCloud || loaded.has(name)) models.add(name);
    }

    if (!loaded.size && (tags.models || []).some((m) => (m.name || m.model) === 'gemma4:latest')) {
      models.add('gemma4:latest');
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
      return c.json({ error: 'Upstream model backend is not reachable', detail: e?.message || String(e) }, 503);
    }
  }

  private targetHostForModel(model?: string): string {
    if (this.apfelHost && model === 'apple-foundationmodel') {
      return this.apfelHost;
    }
    return this.host;
  }

  async forward(c: Context): Promise<Response> {
    // Read body first so model checks can gate before any network call
    const body = c.req.method !== 'GET' ? await c.req.text() : undefined;

    if (c.req.method === 'GET' && c.req.path === '/v1/models') {
      return this.handlePublicModels(c);
    }

    // Extract model for logging and restriction checks
    let model: string | undefined;
    if (body) {
      try {
        const parsed = JSON.parse(body);
        if (parsed.model) {
          model = parsed.model as string;
          c.set('model', model);
        }
      } catch {}
    }

    // Enforce per-key model allowlist (inline — no KeyManager dependency needed)
    const apiKey = c.get('apiKey');
    if (model && apiKey) {
      const allowed = apiKey.allowedModels as string[] | undefined;
      if (allowed && !allowed.includes('*') && !allowed.includes(model)) {
        return c.json({ error: `Model '${model}' is not allowed for this API key` }, 403);
      }
    }

    // Build target URL — treat URL construction errors as a config problem (503)
    let url: URL;
    try {
      url = new URL(this.targetHostForModel(model) + c.req.path);
    } catch {
      return c.json({ error: 'Upstream model backend is not reachable', detail: 'Invalid upstream host configuration' }, 503);
    }

    const headers = new Headers();
    headers.set('Content-Type', c.req.header('Content-Type') || 'application/json');

    try {
      const res = await fetch(url.toString(), {
        method: c.req.method,
        headers,
        body,
        signal: AbortSignal.timeout(300000),
      });

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') || contentType.includes('ndjson')) {
        return new Response(res.body, {
          status: res.status,
          headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        });
      }

      const responseBody = await res.text();
      return new Response(responseBody, {
        status: res.status,
        headers: { 'Content-Type': contentType },
      });
    } catch (e: any) {
      if (e.name === 'TimeoutError') {
        return c.json({ error: 'Ollama request timed out' }, 504);
      }
      return c.json({ error: 'Upstream model backend is not reachable', detail: e.message }, 503);
    }
  }
}
