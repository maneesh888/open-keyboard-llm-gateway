import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { Context } from 'hono';
import type { ApiKey } from '../types/index.js';

type OperationName = 'fix_grammar' | 'summarize' | 'rewrite' | 'continue_writing' | 'translate';

type OperationRequest = {
  operation?: string;
  input_text?: string;
  messages?: Array<{ role?: string; content?: string }>;
  stream?: boolean;
  model?: string;
};

type OpenAIRequestBody = OperationRequest & Record<string, unknown>;
type EffortTarget = 'chat' | 'responses';

type OperationResultItem = {
  id: string;
  type: string;
  title: string;
  text: string;
  original?: string;
  replacement?: string;
  range?: { start: number; end: number };
  confidence?: number;
  explanation?: string;
  category?: string;
};

type OperationResult = {
  operation: string;
  results: OperationResultItem[];
  summary?: string;
  corrected_text?: string;
};

type OpenAIModel = {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
};

export class OllamaProxy {
  private host: string;
  private apfelHost?: string;
  private knownModelsPath: string;

  constructor(host: string, apfelHost?: string, knownModelsPath = './config/known-models.json') {
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
      throw new Error(`Ollama model list failed (${tagsRes.status})`);
    }

    const tags = await tagsRes.json() as { models?: Array<{ name?: string; model?: string }> };
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
      return c.json({ error: 'Upstream model backend is not reachable', detail: e?.message || String(e) }, 503);
    }
  }


  private operationNames = new Set<OperationName>(['fix_grammar', 'summarize', 'rewrite', 'continue_writing', 'translate']);

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

  private parseOperationRequest(body?: string): { parsed?: OpenAIRequestBody; error?: string } {
    if (!body) return {};
    try {
      const raw = JSON.parse(body) as unknown;
      if (!this.isRecord(raw)) return {};
      const parsed = raw as OpenAIRequestBody;
      const operation = typeof parsed.operation === 'string' ? parsed.operation.trim() : '';
      if (!operation) return { parsed };
      if (!this.operationNames.has(operation as OperationName)) return { error: `Unsupported operation '${operation}'` };
      const inputText = typeof parsed.input_text === 'string' ? parsed.input_text : '';
      if (!inputText.trim()) return { error: 'input_text is required when operation is provided' };
      return { parsed };
    } catch {
      return {};
    }
  }

  private operationSystemPrompt(operation: string): string {
    return [
      'You are an API gateway formatting assistant for an iOS keyboard.',
      `Requested operation: ${operation}.`,
      'Return strict JSON only with this contract:',
      '{"operation":"fix_grammar|summarize|rewrite|continue_writing|translate","results":[{"id":"...","type":"correction|suggestion|summary|warning|explanation","title":"...","text":"...","original":"...","replacement":"...","range":{"start":0,"end":0},"confidence":0.0,"explanation":"...","category":"..."}],"summary":"...","corrected_text":"..."}',
      'Use only the supplied input_text and current conversation. Unknown result item types are allowed, but every result item must have type, title, and text.',
      'For fix_grammar, return one correction item per distinct issue. Do not collapse multiple issues into one corrected sentence item.',
      'For fix_grammar item titles should be specific (Capitalization, Subject-verb agreement, Article, Spelling, Missing word, Word choice, Punctuation). Include original, replacement, short explanation, confidence, and range when available.',
      'For clean/no-issue fix_grammar input, return an empty results array and do not invent corrections.',
      'For summarize, return a summary item.',
      'Do not include markdown.',
    ].join('\n');
  }

  private structuredOperationBody(parsed: OperationRequest & Record<string, unknown>): string {
    const operation = parsed.operation?.trim();
    if (!operation) return JSON.stringify(parsed);
    const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
    const inputText = String(parsed.input_text || '').slice(0, 2000);
    return JSON.stringify({
      ...parsed,
      input_text: inputText,
      messages: [
        { role: 'system', content: this.operationSystemPrompt(operation) },
        ...messages,
        { role: 'user', content: `operation=${operation}\ninput_text:\n<<<${inputText}>>>` },
      ],
    });
  }

  private normalizeOperationResponseBody(responseBody: string, operation: string, inputText: string): string {
    try {
      const response = JSON.parse(responseBody) as { choices?: Array<{ message?: { content?: string } }> };
      const content = response.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return responseBody;
      response.choices![0]!.message!.content = JSON.stringify(this.parseOperationResultContent(content, operation, inputText));
      return JSON.stringify(response);
    } catch {
      return responseBody;
    }
  }

  private parseOperationResultContent(content: string, operation: string, inputText: string): OperationResult {
    const stripped = this.unwrapNestedJSONText(this.stripMarkdownFence(content).trim());
    try {
      const parsed = JSON.parse(stripped) as Partial<OperationResult> & { items?: OperationResultItem[] };
      const rawItems = Array.isArray(parsed.results) ? parsed.results : Array.isArray(parsed.items) ? parsed.items : [];
      const normalizedOperation = this.cleanString(parsed.operation) || operation;
      const correctedText = this.cleanCorrectedText(parsed.corrected_text);
      const normalizedItems = rawItems.map((item, index) => this.normalizeResultItem(item, index)).filter((item): item is OperationResultItem => Boolean(item));
      const explicitlyEmpty = normalizedItems.length === 0 && (Array.isArray(parsed.results) || Array.isArray(parsed.items)) && !correctedText;
      const results = explicitlyEmpty ? [] : normalizedItems;
      if (results.length || parsed.corrected_text || parsed.summary || parsed.operation || Array.isArray(parsed.results) || Array.isArray(parsed.items)) {
        return {
          operation: normalizedOperation,
          results,
          ...(this.cleanString(parsed.summary) ? { summary: this.cleanString(parsed.summary) } : {}),
          ...(correctedText ? { corrected_text: correctedText } : {}),
        };
      }
    } catch {}
    const legacy = stripped;
    const nestedLegacy = this.tryParseNestedOperationResult(legacy, operation, inputText);
    if (nestedLegacy) return nestedLegacy;
    if (this.isJSONLike(legacy)) {
      return {
        operation,
        results: [{
          id: 'invalid-structured-response',
          type: 'warning',
          title: 'Invalid structured response',
          text: 'The model returned malformed JSON and no safe keyboard text could be extracted.',
        }],
      };
    }
    const itemType = operation === 'summarize' ? 'summary' : 'correction';
    const title = operation === 'summarize' ? 'Summary' : operation === 'fix_grammar' ? 'Grammar correction' : 'Writing result';
    const legacyResults = [{ id: 'legacy-1', type: itemType, title, text: legacy, ...(operation === 'fix_grammar' ? { original: inputText, replacement: legacy } : {}) }] as OperationResultItem[];
    return {
      operation,
      results: legacyResults,
      ...(operation === 'fix_grammar' ? { corrected_text: this.cleanCorrectedText(legacy) || legacy } : { summary: legacy }),
    };
  }


  private cleanCorrectedText(value: unknown): string | undefined {
    const cleaned = this.cleanString(value);
    if (!cleaned) return undefined;
    if (!this.isJSONLike(cleaned)) return cleaned;
    try {
      const parsed = JSON.parse(cleaned) as Partial<OperationResult> & { corrected_text?: unknown };
      const nested = this.cleanString(parsed.corrected_text);
      if (nested && !this.isJSONLike(nested)) return nested;
    } catch {}
    return undefined;
  }

  private tryParseNestedOperationResult(value: string, operation: string, inputText: string): OperationResult | undefined {
    if (!this.isJSONLike(value)) return undefined;
    try {
      const parsed = JSON.parse(value) as Partial<OperationResult> & { choices?: Array<{ message?: { content?: string } }> };
      const nestedContent = parsed.choices?.[0]?.message?.content;
      if (typeof nestedContent === 'string') return this.parseOperationResultContent(nestedContent, operation, inputText);
      if (parsed.operation || parsed.results || parsed.corrected_text || parsed.summary) {
        return this.parseOperationResultContent(JSON.stringify(parsed), operation, inputText);
      }
    } catch {}
    return undefined;
  }

  private unwrapNestedJSONText(value: string): string {
    let current = value;
    for (let i = 0; i < 3; i += 1) {
      if (!this.isJSONLike(current)) return current;
      try {
        const parsed = JSON.parse(current) as unknown;
        if (typeof parsed === 'string') {
          current = parsed.trim();
          continue;
        }
      } catch {}
      return current;
    }
    return current;
  }

  private isJSONLike(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    return trimmed.startsWith('{') || trimmed.startsWith('[');
  }

  private normalizeResultItem(item: Partial<OperationResultItem>, index: number): OperationResultItem | null {
    const text = this.cleanString(item.text || item.replacement || item.explanation || item.title);
    if (!text) return null;
    const type = this.cleanString(item.type) || 'suggestion';
    return {
      id: this.cleanString(item.id) || `item-${index + 1}`,
      type,
      title: this.cleanString(item.title) || (type === 'summary' ? 'Summary' : type === 'correction' ? 'Correction' : 'Writing result'),
      text,
      ...(this.cleanString(item.original) ? { original: this.cleanString(item.original) } : {}),
      ...(this.cleanString(item.replacement) ? { replacement: this.cleanString(item.replacement) } : {}),
      ...(item.range && Number.isFinite(item.range.start) && Number.isFinite(item.range.end) ? { range: { start: item.range.start, end: item.range.end } } : {}),
      ...(typeof item.confidence === 'number' ? { confidence: item.confidence } : {}),
      ...(this.cleanString(item.explanation) ? { explanation: this.cleanString(item.explanation) } : {}),
      ...(this.cleanString(item.category) ? { category: this.cleanString(item.category) } : {}),
    };
  }

  private cleanString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private stripMarkdownFence(value: string): string {
    let trimmed = value.trim();
    if (!trimmed.startsWith('```')) return value;
    trimmed = trimmed.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '');
    return trimmed.trim();
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

    // Extract model and optional OpenKeyboard operation contract fields for checks and prompt shaping.
    let model: string | undefined;
    let outboundBody = body;
    let operation: string | undefined;
    let inputText: string | undefined;
    if (body) {
      const shouldHandleOperation = c.req.method === 'POST' && c.req.path === '/v1/chat/completions';
      const operationRequest = shouldHandleOperation ? this.parseOperationRequest(body) : {};
      if (operationRequest.error) return c.json({ error: operationRequest.error }, 400);
      const parsed = operationRequest.parsed || this.parseJSONRequestBody(body);
      if (parsed?.model && typeof parsed.model === 'string') {
        model = parsed.model;
        c.set('model', model);
      }
      if (shouldHandleOperation && parsed?.operation && typeof parsed.operation === 'string') {
        if (parsed.stream === true) return c.json({ error: 'stream must be false when operation is provided' }, 400);
        operation = parsed.operation.trim();
        inputText = typeof parsed.input_text === 'string' ? parsed.input_text.slice(0, 2000) : '';
        outboundBody = this.structuredOperationBody({ ...parsed, stream: false });
      }
    }

    const apiKey = c.get('apiKey') as ApiKey | undefined;
    outboundBody = this.applyConfiguredEffort(outboundBody, c.req.path, apiKey);

    // Enforce per-key model allowlist (inline — no KeyManager dependency needed)
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
        body: outboundBody,
        signal: AbortSignal.timeout(300000),
      });

      if (res.ok && model) this.rememberModel(model);

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') || contentType.includes('ndjson')) {
        return new Response(res.body, {
          status: res.status,
          headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
        });
      }

      const rawResponseBody = await res.text();
      const responseBody = operation && inputText && c.req.path === '/v1/chat/completions' && res.ok
        ? this.normalizeOperationResponseBody(rawResponseBody, operation, inputText)
        : rawResponseBody;
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
