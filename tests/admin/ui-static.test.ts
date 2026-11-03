import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const html = readFileSync(join(process.cwd(), 'public/admin/index.html'), 'utf-8');
const playgroundLogic = readFileSync(join(process.cwd(), 'public/admin/playground.js'), 'utf-8');

describe('Admin UI static contract', () => {
  it('includes responsive mobile card markers', () => {
    expect(html).toContain('@media (max-width: 700px)');
    expect(html).toContain('class="table-wrap"');
    expect(html).toContain('data-label="Name"');
    expect(html).toContain('data-label="Model"');
    expect(html).toContain('data-label="Rate limit"');
    expect(html).toContain('data-label="Access"');
    expect(html).toContain('data-label="Actions"');
    expect(html).toContain('.page.active>*{min-width:0}');
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
    expect(html).toContain('new Error(apiErrorMessage(data,`HTTP ${r.status}`))');
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

  it('exposes the key tester as a generic connection test with clear result states', () => {
    expect(html).toContain('data-page="playground"');
    expect(html).toContain('id="testerKey"');
    expect(html).toContain('id="testerModel"');
    expect(html).toContain('id="testerModelManual"');
    expect(html).toContain('<label for="testerPrompt">Message</label>');
    expect(html).toContain('id="testerSystemPrompt"');
    expect(html).toContain('<summary>System prompt</summary>');
    expect(html).toContain('function testerSelectedModel()');
    expect(html).toContain('function setTesterModel(value)');
    expect(html).toContain('function syncTesterModelForKey()');
    expect(html).toContain("(key default)");
    expect(html).toContain('<script src="/ui/playground.js"></script>');
    expect(html).not.toContain('id="testerPromptPreset"');
    expect(html).not.toContain('Test preset');
    expect(html).toContain("const CONNECTION_SYSTEM_PROMPT='");
    expect(html).toContain("CONNECTION_USER_MESSAGE='Reply with: connection ok'");
    expect(html).toContain('function setConnectionTestDefaults()');
    expect(html).toContain('setConnectionTestDefaults();');
    expect(html).toContain('It adds no semantic operation or structured response request.');
    expect(html).not.toContain('SemanticPromptContractBrowser');
    expect(html).not.toContain('gatewayPromptPresets');
    expect(html).not.toContain('OpenKeyboardCore · ');
    expect(html).not.toContain('Live harness · ');
    expect(html).not.toContain("id:'fix-grammar'");
    // Result states: not run, loading, success, failure and recovery stay distinct.
    expect(html).toContain("titles={idle:'Not run yet',running:'Testing…',ok:'Passed',fail:'Failed'}");
    expect(html).toContain('id="testerRecovery"');
    expect(html).toContain('>Try again</button>');
    expect(html).toContain("testerRun.disabled=busy");
    expect(html).toContain("byId('testerResult').setAttribute('aria-busy'");
    // A result never outlives the key/model it was produced for, and late responses are ignored.
    expect(html).toContain('onchange="syncManualModel(\'tester\');clearTestResult()"');
    expect(html).toContain('function clearTestResult(){testRun++');
    expect(html).toContain('if(run!==testRun)return;');
    // Credential material is fetched only when a test runs.
    expect(html).toContain('The full key is only fetched when the test runs.');
    expect(html).toContain("fetchPolicy:'on-test-only'");
    expect(html).toContain('function renderTesterKeys()');
    expect(html).toContain('function getFullKey(id)');
    expect(html).toContain('api(`/admin/keys/${id}`)');
    expect(html).toContain('fullKeyFetched');
    expect(html).toContain("role:'system'");
    expect(html).toContain('messageRoles:body.messages.map');
    expect(html).toContain("testType:'connection-smoke'");
    expect(html).not.toContain('promptPreset:preset');
    expect(html).toContain('systemPromptLength:systemPrompt.length');
    expect(html).toContain("fetch('/v1/chat/completions'");
    expect(html).toContain("endpoint:'/v1/chat/completions'");
    expect(html).toContain('Selected key is disabled. Enable it on the Keys page before testing.');
    expect(html).toContain('selectedModel=testerSelectedModel()');
    expect(html).not.toContain('testerSelectedModel()||k?.modelConfig?.model');
    expect(html).not.toContain('data={raw}');
    expect(html).not.toContain('data.detail||raw');
    expect(html).toContain('function classify(status,data,err,model)');
    expect(html).toContain('classifyPlaygroundError(status,data,err,model)');
    expect(playgroundLogic).not.toContain("code === 'provider_unavailable'");
  });

  it('uses a single top bar for navigation with history support', () => {
    expect(html).toContain('class="topbar"');
    expect(html).toContain(`onclick="navigateTo('keys')"`);
    expect(html).toContain(`onclick="navigateTo('playground')"`);
    expect(html).toContain('class="signout" onclick="logout()">Sign out</button>');
    expect(html).not.toContain('id="sidebar"');
    expect(html).not.toContain('id="drawerToggle"');
    expect(html).not.toContain('class="mobile-tabs"');
    expect(html).toContain("document.querySelectorAll('.nav-link')");
    expect(html).toContain('history.replaceState(null');
    expect(html).toContain("history.pushState(null,'',next);applyRoute()");
    expect(html).toContain("addEventListener('popstate',applyRoute)");
    expect(html).toContain("addEventListener('hashchange',applyRoute)");
    expect(html).not.toContain('← API Keys');
  });

  it('lists semantic and keyboard operation identifiers without runnable semantic presets', () => {
    expect(html).toContain('<h2 id="operationCatalogTitle">Operations</h2>');
    expect(html).toContain('read only, from the pinned semantic contract');
    expect(html).toContain('id="operationCatalog"');
    expect(html).toContain('id="operationCatalogVersion"');
    expect(html).toContain("fetch('/ui/semantic-operations.json')");
    expect(html).toContain('<th scope="col" style="width:170px">Sent as</th>');
    expect(html).toContain('<td class="not-sent">not sent</td>');
    expect(html).toContain("function operationCountLabel(count){return `${count} operation${count===1?'':'s'}`}");
    expect(html).toContain('function renderSemanticOperations(catalog)');
    expect(html).toContain('function loadSemanticOperations()');
    expect(html).not.toContain('<script src="/ui/semantic-prompt-contract.js"></script>');
    expect(html).not.toContain('Structured operation ·');
    expect(html).not.toContain('Plain-text grammar ·');
    expect(html).not.toContain('response_format');
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
    expect(html).toContain('No models were discovered. If you use Ollama, pull one first; otherwise choose Custom and enter the exact model name.');
    expect(html).toContain('id="keyModel"');
    expect(html).toContain("onchange=\"syncManualModel('key')\"");
    expect(html).toContain('function syncManualModel(prefix)');
    expect(html).toContain('modelSelectionForKey(availableModels,value)');
    expect(html).toContain('populateModelSelect(keyModel);keyModelManual.classList.add');
    expect(html).not.toContain('populateModelSelect(keyModel,availableModels[0])');
    expect(html).not.toContain("onclick=\"toggleManualModel('tester')");
    expect(html).toContain('Custom… (type a model name)');
  });

  it('separates key access, model state and inference, with controls in the row menu', () => {
    expect(html).toContain('<th scope="col">Access</th>');
    expect(html).toContain("api('/admin/models/status'");
    expect(html).toContain("api('/admin/models/start'");
    expect(html).toContain("api('/admin/models/stop'");
    expect(html).toContain('function checkConfiguredModels(onlyModel)');
    expect(html).toContain('function startConfiguredModel(model)');
    expect(html).toContain('function stopConfiguredModel(model)');
    expect(html).toContain('renderTesterKeys();await checkConfiguredModels()');
    expect(html).toContain('status?.guidance');
    expect(html).not.toContain('no model tokens used');
    // Labels derive from provider/service/runtime so different causes are never merged.
    for (const label of ['Not checked', 'Provider not configured', 'On-device, ready', 'Apfel offline', 'Apple model unavailable', 'Loaded', 'Not loaded, loads on first use', 'Cloud, not tested', 'Listed, load state unknown', 'Not downloaded']) {
      expect(html).toContain(`'${label}'`);
    }
    expect(html).toContain('offline`');
    expect(html).toContain("Load into memory");
    expect(html).toContain("Unload from memory");
    expect(html).toContain('completed for ${model}.');
    expect(html).not.toContain(': done for ${model}');
    expect(html).toContain('Neither runs a prompt.');
    // Model state is never conveyed by color alone.
    expect(html).toContain('<span class="dot ${state.tone?');
    expect(html).toContain('<span>${escapeHtml(state.label)}</span>');
    // Stopping a whole service affects every key on it, so it must be confirmed.
    expect(html).toContain("before?.stop?.action==='stop_service'");
    expect(html).toContain('for every key that uses it');
    // Row menu semantics.
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("e.key==='Escape'&&rowMenu.classList.contains('open')");
  });

  it('keeps stored key and model values out of executable row-menu markup', () => {
    expect(html).toContain('data-key-action="tester"');
    expect(html).toContain('data-key-action="copy"');
    expect(html).toContain('data-key-action="menu"');
    expect(html).toContain('data-menu-action="${action}"');
    expect(html).toContain("rowMenu.addEventListener('click'");
    expect(html).not.toContain('safeModel=');
    expect(html).not.toContain('onclick="closeRowMenu();');
    expect(html).not.toContain("onclick=\"openRowMenu('");
  });

  it('bounds a long row menu inside short viewports', () => {
    expect(html).toContain('max-height:calc(100vh - 16px);overflow-y:auto');
    expect(html).toContain('maxTop=Math.max(8,innerHeight-h-8)');
    expect(html).toContain('Math.max(8,Math.min(below,maxTop))');
    expect(html).toContain('const go=n=>items[n]?.focus()');
    expect(html).not.toContain('const go=n=>items[n]?.focus({preventScroll:true})');
    expect(html).not.toContain("addEventListener('scroll',()=>closeRowMenu(false),true)");
  });

  it('invalidates a tester result when the selected key configuration changes', () => {
    expect(html).toContain('let testerLoadedKeyState=null');
    expect(html).toContain('keyState=JSON.stringify([id,k||null])');
    expect(html).toContain("keyState===testerLoadedKeyState&&testerStatus.textContent!=='Not run yet'");
    expect(html).not.toContain("id===testerLoadedKey&&testerStatus.textContent!=='Not run yet'");
  });

  it('confirms deletion in an in-page dialog that names the key', () => {
    expect(html).toContain('<dialog id="confirmDialog"');
    expect(html).toContain('title:`Delete ${k?.name||\'this key\'}?`');
    expect(html).toContain("Clients using this key lose access immediately. This can\\'t be undone.");
    expect(html).not.toContain("confirm('Delete this key?')");
  });

  it('keeps key form errors inside the dialog', () => {
    expect(html).toContain('<dialog id="keyModal"');
    expect(html).toContain('id="keyFormError" role="alert"');
    expect(html).toContain('function showFormError(msg)');
    expect(html).toContain('}catch(e){showFormError(e.message)}});');
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
    expect(html).toContain('<label for="keyEffort">Reasoning effort (default)</label>');
    expect(html).toContain('<option value="">Unset</option>');
    expect(html).toContain('<option value="low">Low</option>');
    expect(html).toContain('<option value="medium">Medium</option>');
    expect(html).toContain('<option value="high">High</option>');
    expect(html).toContain("keyEffort.value=''");
    expect(html).toContain("keyEffort.value=k.modelConfig?.effort||''");
    expect(html).toContain('const effort=keyEffort.value,modelConfig={model,maxTokens:+keyMaxTokens.value,temperature:+keyTemperature.value}');
    expect(html).toContain('if(effort)modelConfig.effort=effort');
  });
});
