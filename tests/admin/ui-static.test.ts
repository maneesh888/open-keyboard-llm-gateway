import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const html = readFileSync(join(process.cwd(), 'public/admin/index.html'), 'utf-8');
const semanticAdapter = readFileSync(
  join(process.cwd(), 'Vendor/semantic-prompt-contract/adapters/browser/semanticPromptContract.generated.js'),
  'utf-8',
);

describe('Admin UI static contract', () => {
  it('includes responsive mobile card markers', () => {
    expect(html).toContain('@media (max-width: 700px)');
    expect(html).toContain('class="table-wrap"');
    expect(html).toContain('data-label="Name"');
    expect(html).toContain('data-label="API Key"');
    expect(html).toContain('data-label="Rate Limit"');
    expect(html).toContain('data-label="Status"');
    expect(html).toContain('data-label="Actions"');
  });

  it('keeps all required admin UI functions wired', () => {
    const functions = [
      'loadKeys',
      'renderKeys',
      'showCreateModal',
      'closeModal',
      'toggleKey',
      'deleteKey',
      'logout',
      'showError',
      'showSuccess',
    ];

    for (const fn of functions) {
      expect(html).toMatch(new RegExp(`function\\s+${fn}\\s*\\(`));
    }

    expect(html).toContain("id=\"loginForm\"");
    expect(html).toContain("id=\"keyForm\"");
    expect(html).toContain("showCreateModal()");
    expect(html).toContain("logout()");
  });

  it('uses the expected admin API endpoints', () => {
    expect(html).toContain("fetch('/admin/login'");
    expect(html).toContain("fetch('/admin/keys'");
    expect(html).toContain('fetch(`/admin/keys/${keyId}`');
  });

  it('decodes nested OpenAI error messages in admin and playground requests', () => {
    expect(html).toContain('function apiErrorMessage(data,fallback)');
    expect(html).toContain("typeof error==='object'&&typeof error.message==='string'");
    expect(html).toContain('new Error(apiErrorMessage(data,`Request failed (${r.status})`))');
    expect(html).toContain("new Error(apiErrorMessage(data,'Invalid credentials'))");
    expect(html).toContain('new Error(apiErrorMessage(data,data.detail||raw||`HTTP ${r.status}`))');
  });

  it('persists admin login until token expiry', () => {
    expect(html).toContain("const AUTH_STORAGE_KEY='llmGatewayAdminSession'");
    expect(html).toContain('function saveSession(token,expiresIn)');
    expect(html).toContain('function readSession()');
    expect(html).toContain('function restoreSession()');
    expect(html).toContain('fullKeys={}');
    expect(html).toContain('restoreSession();');
    expect(html).toContain('clearSession();dashboardScreen.classList.remove');
  });

  it('exposes independent playground and key tester workflow with responsive navigation', () => {
    expect(html).toContain('LLM Playground / Key Tester');
    expect(html).toContain('data-page="playground"');
    expect(html).toContain('id="testerKey"');
    expect(html).toContain('id="testerKeyFetchStatus"');
    expect(html).toContain('id="testerKeyHint"');
    expect(html).toContain('id="testerModelCatalog"');
    expect(html).toContain('id="testerReadiness"');
    expect(html).toContain('id="testerModel"');
    expect(html).toContain('id="testerModelManual"');
    expect(html).toContain('Defaults to the selected key model, but can be overridden for one-off diagnostics.');
    expect(html).toContain('class="tester-summary"');
    expect(html).toContain('function testerSelectedModel()');
    expect(html).toContain('function updateTesterReadiness()');
    expect(html).toContain('function setTesterModel(value)');
    expect(html).toContain('function syncTesterModelForKey()');
    expect(html).toContain('syncTesterModelForKey();updateModelCatalogStatus()');
    expect(html).toContain('Selected model: ${model}');
    expect(html).toContain('Fetch on test');
    expect(html).toContain('fetchPolicy:\'on-test-only\'');
    expect(html).toContain('Keys are loaded from the admin API; full key material is fetched only for the selected live test.');
    expect(html).toContain("const preferredModelOrder=['apple-foundationmodel'");
    expect(html).toContain('function updateModelCatalogStatus()');
    expect(html).toContain('models available · default');
    expect(html).toContain('manual fallback available');
    expect(html).toContain('admin keys loaded. Select one to fetch the full key and run a real chat completion.');
    expect(html).toContain('id="testerPromptPreset"');
    expect(html).toContain('Test preset');
    expect(html).toContain('id="testerSystemPrompt"');
    expect(html).toContain('System prompt');
    expect(html).toContain('User message');
    expect(html).toContain('grid-template-columns:minmax(430px,520px) minmax(0,1fr)');
    expect(html).toContain('class="panel tester-panel"');
    expect(html).toContain('.tester-panel textarea{min-height:120px}');
    expect(html).toContain('.tester-panel #testerPrompt{min-height:150px}');
    expect(html).toContain("const DEFAULT_PROMPT_PRESET='connection-smoke'");
    expect(html).toContain('function populatePromptPresets()');
    expect(html).toContain('function clearPlaygroundConversation');
    expect(html).toContain("Preset changed. Run the selected test to start a new result.");
    expect(html).toContain('function applyPromptPreset(id,opts={})');
    expect(html).toContain('if(opts.clearConversation)clearPlaygroundConversation()');
    expect(html).toContain('onchange="applyPromptPreset(this.value,{clearConversation:true})"');
    expect(html).toContain('Connection smoke');
    expect(html).toContain('SemanticPromptContractBrowser');
    expect(html).toContain("...(semanticContract?.gatewayPromptPresets||[])");
    expect(semanticAdapter).toContain('Structured grammar · Multi-error');
    expect(semanticAdapter).toContain('Structured grammar · Clean/no issue');
    expect(semanticAdapter).toContain('Structured operation · Summarize');
    expect(semanticAdapter).toContain('Structured operation · Rewrite');
    expect(html).not.toContain('OpenKeyboardCore · Fix Grammar');
    expect(html).not.toContain('OpenKeyboardCore · Rewrite');
    expect(html).not.toContain('OpenKeyboardCore · Summarize');
    expect(html).not.toContain('OpenKeyboardCore · Translate to Arabic');
    expect(html).not.toContain('OpenKeyboardCore · Continue Writing');
    expect(html).not.toContain('Live harness · Fix Grammar');
    expect(html).not.toContain('Live harness · Summarize');
    expect(html).not.toContain('Connection smoke · grammar correction');
    expect(html).not.toContain("id:'fix-grammar'");
    expect(html).not.toContain("id:'live-fix-grammar'");
    expect(html).not.toContain("id:'structured-mixed-explanations'");
    expect(html).toContain('function renderTesterKeys()');
    expect(html).toContain('function getFullKey(id)');
    expect(html).toContain('api(`/admin/keys/${id}`)');
    expect(html).toContain('Will fetch full key when test runs');
    expect(html).toContain('fullKeyFetched');
    expect(html).toContain("role:'system'");
    expect(html).toContain('messageRoles:body.messages.map');
    expect(html).toContain('promptPreset:preset');
    expect(html).toContain('contractVersion:presetDefinition?.contractVersion||null');
    expect(html).toContain('...(presetDefinition?.request||{})');
    expect(html).toContain('systemPromptLength:systemPrompt.length');
    expect(html).toContain("fetch('/v1/chat/completions'");
    expect(html).toContain("endpoint:'/v1/chat/completions'");
    expect(html).toContain('Selected key is disabled. Enable it before running a live chat test.');
    expect(html).toContain('function classify(status,data,err)');
    expect(html).toContain('Request validation failed: check model and messages fields.');
    expect(html).toContain('Endpoint or model not found: verify /v1/chat/completions and the selected model name.');
    expect(html).toContain('Upstream unavailable: Ollama/Apfel backend is not reachable.');
    expect(html).toContain('Network/browser error: check gateway reachability and TLS/CORS from this admin session.');
    expect(html.indexOf("if(/Failed to fetch|NetworkError|Load failed/i.test(text))")).toBeLessThan(html.indexOf("if(status>=500||/Ollama|reachable/i.test(text))"));
    expect(html).toContain('history.replaceState(null');
    expect(html).toContain("history.pushState(null,'',next);applyRoute()");
    expect(html).toContain("window.addEventListener('popstate',applyRoute)");
    expect(html).toContain('Ready to test selected key.');
    expect(html).toContain('Choose an API key to run a live test.');
    expect(html).toContain('if(route.keyId&&testerKey.value)');
    expect(html).toContain(`onclick="navigateTo('keys')"`);
    expect(html).not.toContain('← API Keys');
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('id="drawerToggle"');
    expect(html).toContain('class="drawer-backdrop"');
    expect(html).toContain('function setDrawer(open)');
    expect(html).toContain('function toggleDrawer()');
    expect(html).toContain('function closeDrawer()');
    expect(html).toContain("sidebar.classList.toggle('open',open)");
    expect(html).toContain("drawerBackdrop.classList.toggle('show',open)");
    expect(html).toContain("drawerToggle.setAttribute('aria-expanded'");
    expect(html).toContain("window.addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer()})");
    expect(html).toContain('class="mobile-tabs"');
    expect(html).toContain('.mobile-tabs{display:flex');
    expect(html).toContain('class="mobile-tab" data-page="playground"');
    expect(html).toContain("document.querySelectorAll('.nav-pill,.mobile-tab')");
    expect(html).toContain("window.addEventListener('hashchange',applyRoute)");
    expect(html).toContain('@media(min-width:1001px)');
    expect(html).toContain('.dashboard-container.active{display:grid;grid-template-columns:260px minmax(0,1fr)}');
    expect(html).toContain('.sidebar{position:sticky;top:0;inset:auto;grid-column:1;transform:none;box-shadow:none}');
    expect(html).toContain('.drawer-toggle,.drawer-backdrop,.mobile-tabs{display:none!important}');
    expect(html).toContain('@media(max-width:1000px)');
  });


  it('loads semantic diagnostics from the pinned generated contract adapter', () => {
    expect(html).toContain('Connection smoke');
    expect(html).toContain('The gateway forwards these messages without adding application-specific instructions.');
    expect(html).toContain('<script src="/ui/semantic-prompt-contract.js"></script>');
    expect(html).not.toContain('one atomic correction result per distinct issue');
    expect(html).not.toContain('testerRequestJson');
    expect(html).not.toContain('testerExpectedSchema');
    expect(semanticAdapter).toContain('Generated from contracts/*.json');
    expect(semanticAdapter).toContain('"contractVersion":"2.0.1"');
    expect(semanticAdapter).toContain('"operation":"fix_grammar"');
    expect(semanticAdapter).toContain('"input_text"');
    expect(semanticAdapter).toContain('"response_format":{"type":"json_object"}');
  });


  it('normalizes invalid admin routes after login and exposes active nav state', () => {
    expect(html).toContain('needsNormalize');
    expect(html).toContain('isLoginRoute');
    expect(html).toContain('function safeDecodeRoutePart(v)');
    expect(html).toContain('decodeURIComponent(v)');
    expect(html).toContain('keyId:page===\'playground\'&&parts[1]?safeDecodeRoutePart(parts[1]):null');
    expect(html).toContain("const loginRoute=parseRoute();if(loginRoute.needsNormalize||loginRoute.isLoginRoute)history.replaceState(null,'',routeFor('keys'))");
    expect(html).toContain("if(route.needsNormalize&&authToken)history.replaceState(null,'',routeFor(route.page,route.keyId))");
    expect(html).toContain("if(location.hash!=='#login')history.replaceState(null,'','#login')");
    expect(html).toContain("b.setAttribute('aria-current',active?'page':'false')");
  });

  it('uses model selector with manual fallback for key creation/editing', () => {
    expect(html).toContain("api('/admin/models'");
    expect(html).toContain('id="keyModel"');
    expect(html).toContain("onchange=\"syncManualModel('key')\"");
    expect(html).toContain('function syncManualModel(prefix)');
    expect(html).toContain('function preferredModel()');
    expect(html).toContain('populateModelSelect(keyModel);keyModelManual.classList.add');
    expect(html).not.toContain('populateModelSelect(keyModel,availableModels[0])');
    expect(html).toContain('Custom / manual…');
  });

  it('places effort below model and keeps temperature last in model settings', () => {
    const modelIndex = html.indexOf('id="keyModel"');
    const effortIndex = html.indexOf('id="keyEffort"');
    const maxTokensIndex = html.indexOf('id="keyMaxTokens"');
    const temperatureIndex = html.indexOf('id="keyTemperature"');
    const enabledIndex = html.indexOf('id="keyEnabled"');

    expect(modelIndex).toBeGreaterThan(-1);
    expect(effortIndex).toBeGreaterThan(-1);
    expect(maxTokensIndex).toBeGreaterThan(-1);
    expect(temperatureIndex).toBeGreaterThan(-1);
    expect(enabledIndex).toBeGreaterThan(-1);
    expect(modelIndex).toBeLessThan(effortIndex);
    expect(effortIndex).toBeLessThan(temperatureIndex);
    expect(maxTokensIndex).toBeLessThan(temperatureIndex);
    expect(temperatureIndex).toBeLessThan(enabledIndex);
  });

  it('persists optional effort from the key modal into modelConfig', () => {
    expect(html).toContain('<label for="keyEffort">Effort</label>');
    expect(html).toContain('<option value="">Unset</option>');
    expect(html).toContain('<option value="low">Low</option>');
    expect(html).toContain('<option value="medium">Medium</option>');
    expect(html).toContain('<option value="high">High</option>');
    expect(html).toContain("keyEffort.value=''");
    expect(html).toContain("keyEffort.value=k.modelConfig?.effort||''");
    expect(html).toContain('const effort=keyEffort.value,modelConfig={model,maxTokens:+keyMaxTokens.value,temperature:+keyTemperature.value}');
    expect(html).toContain('if(effort)modelConfig.effort=effort');
    expect(html).toContain('Effort: ${escapeHtml(effort)}');
    expect(html).toContain('testerModelSummary.value=k?.modelConfig?.model?`${k.modelConfig.model} · effort ${effort}`');
  });
});
