(function installAdminPlaygroundLogic(root) {
  const CUSTOM_MODEL_VALUE = '__custom__';

  function normalizeModels(models) {
    return [...new Set((Array.isArray(models) ? models : [])
      .filter((model) => typeof model === 'string')
      .map((model) => model.trim())
      .filter(Boolean))];
  }

  function buildModelOptions(discoveredModels, configuredModel) {
    const configured = typeof configuredModel === 'string' ? configuredModel.trim() : '';
    return normalizeModels([...normalizeModels(discoveredModels), configured]);
  }

  function modelSelectionForKey(discoveredModels, configuredModel) {
    const configured = typeof configuredModel === 'string' ? configuredModel.trim() : '';
    return {
      options: buildModelOptions(discoveredModels, configured),
      selectValue: configured,
      manualValue: '',
      manualVisible: false,
    };
  }

  function resolveSelectedModel(selectValue, manualValue) {
    return selectValue === CUSTOM_MODEL_VALUE
      ? String(manualValue || '').trim()
      : String(selectValue || '').trim();
  }

  function catalogCountLabel(discoveredModels) {
    return `${normalizeModels(discoveredModels).length} models available`;
  }

  function structuredErrorCode(data) {
    return data && typeof data === 'object'
      && data.error && typeof data.error === 'object'
      && typeof data.error.code === 'string'
      ? data.error.code
      : '';
  }

  function classifyPlaygroundError(status, data, err, selectedModel) {
    const code = structuredErrorCode(data);
    const text = JSON.stringify(data || {}) + ' ' + (err?.message || '');

    if (code === 'provider_unavailable') {
      return selectedModel === 'codex'
        ? 'Codex provider unavailable: verify its protected credential and runtime configuration.'
        : 'Selected model provider is unavailable.';
    }
    if (code === 'upstream_unreachable') {
      return 'Upstream unavailable: Ollama/Apfel backend is not reachable.';
    }
    if (status === 400) return 'Request validation failed: check model and messages fields.';
    if (status === 401) return 'Authentication failed: missing/invalid API key.';
    if (status === 403 && /not allowed/i.test(text)) return 'Model permission failed: this key cannot use the selected model.';
    if (status === 403) return 'Forbidden: key may be disabled or blocked.';
    if (status === 404) return 'Endpoint or model not found: verify /v1/chat/completions and the selected model name.';
    if (status === 429) return 'Rate limited: request quota exceeded.';
    if (status === 502) return 'Gateway upstream error: admin or model backend returned a bad response.';
    if (status === 503) return 'Upstream unavailable: Ollama/Apfel backend is not reachable.';
    if (status === 504 || /timed out/i.test(text)) return 'Timeout: upstream model did not respond in time.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(text)) return 'Network/browser error: check gateway reachability and TLS/CORS from this admin session.';
    if (status >= 500 || /Ollama|reachable/i.test(text)) return 'Upstream/Ollama error: gateway could not complete the model request.';
    if (err) return 'Network/browser error while calling the gateway.';
    return 'Unknown error.';
  }

  root.AdminPlaygroundLogic = Object.freeze({
    CUSTOM_MODEL_VALUE,
    buildModelOptions,
    modelSelectionForKey,
    resolveSelectedModel,
    catalogCountLabel,
    classifyPlaygroundError,
  });
})(globalThis);
