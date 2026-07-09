import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const html = readFileSync(join(process.cwd(), 'public/admin/index.html'), 'utf-8');

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

  it('persists admin login until token expiry', () => {
    expect(html).toContain("const AUTH_STORAGE_KEY='llmGatewayAdminSession'");
    expect(html).toContain('function saveSession(token,expiresIn)');
    expect(html).toContain('function readSession()');
    expect(html).toContain('function restoreSession()');
    expect(html).toContain('restoreSession();');
    expect(html).toContain('clearSession();dashboardScreen.classList.remove');
  });

  it('exposes independent playground and key tester workflow with responsive navigation', () => {
    expect(html).toContain('LLM Playground / Key Tester');
    expect(html).toContain('data-page="playground"');
    expect(html).toContain('id="testerKey"');
    expect(html).toContain('id="testerKeyFetchStatus"');
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
    expect(html).toContain('Structured grammar · Multi-error');
    expect(html).toContain('Structured grammar · Clean/no issue');
    expect(html).toContain('Structured operation · Summarize');
    expect(html).toContain('Structured operation · Rewrite');
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
    expect(html).toContain('Checking admin API…');
    expect(html).toContain('fullKeyFetched');
    expect(html).toContain("role:'system'");
    expect(html).toContain('messageRoles:(body.messages||[]).map');
    expect(html).toContain('promptPreset:preset');
    expect(html).toContain('systemPromptLength:systemPrompt.length');
    expect(html).toContain("fetch('/v1/chat/completions'");
    expect(html).toContain("endpoint:'/v1/chat/completions'");
    expect(html).toContain('Selected key is disabled. Enable it before running a live chat test.');
    expect(html).toContain('function classify(status,data,err)');
    expect(html).toContain('history.replaceState(null');
    expect(html).toContain("history.pushState(null,'',next);applyRoute()");
    expect(html).toContain("window.addEventListener('popstate',applyRoute)");
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


  it('exposes OpenKeyboard structured operation playground samples', () => {
    expect(html).toContain('OpenKeyboard structured operation samples');
    expect(html).toContain('id="testerRequestJson"');
    expect(html).toContain('id="testerExpectedSchema"');
    expect(html).toContain('Developer/debug: view generated request and expected schema');
    expect(html).toContain('Copy generated request');
    expect(html).toContain('This preset sends operation + input_text and asks the model to return structured JSON results.');
    expect(html).toContain('unsupported operation → 400');
    expect(html).toContain('missing input_text with operation → 400');
    expect(html).toContain('input_text is bounded server-side');
    expect(html).toContain('Structured grammar · Multi-error');
    expect(html).toContain('Structured grammar · Complex spell-fix');
    expect(html).toContain('Structured grammar · Clean/no issue');
    expect(html).toContain('Structured operation · Summarize');
    expect(html).toContain('Structured operation · Rewrite');
    expect(html).not.toContain('OpenKeyboard structured · Mixed result types');
    expect(html).toContain("operation:'fix_grammar'");
    expect(html).toContain("input_text:'i has a apple,ths is nt sound god'");
    expect(html).toContain("input_text:'i definately recieve teh adress tomorow");
    expect(html).toContain("operation:'summarize'");
    expect(html).toContain("operation:'rewrite'");
    expect(html).toContain('results:[');
    expect(html).toContain("type:'correction'");
    expect(html).toContain("type:'suggestion'");
    expect(html).toContain("type:'warning'");
    expect(html).toContain("type:'explanation'");
    expect(html).toContain('corrected_text');
    expect(html).toContain('Subject-verb agreement');
    expect(html).toContain('range:{start:0,end:1}');
    expect(html).toContain('confidence:0.98');
    expect(html).toContain('category');
    expect(html).toContain('spell-receive-2');
    expect(html).toContain('Eleven corrections found.');
    expect(html).toContain('summary');
    expect(html).toContain('function copySampleJson()');
    expect(html).toContain('JSON.parse(requestJson)');
    expect(html).toContain("Generated request JSON must be an object.");
    expect(html).toContain('body.model=selectedModel');
    expect(html).toContain('body:JSON.stringify(body)');
  });


  it('keeps structured presets meaningful in visible prompt fields', () => {
    const structuredIds = [
      'structured-multi-error-grammar',
      'structured-complex-spell-fix',
      'structured-clean-grammar',
      'structured-summarize',
      'structured-rewrite',
    ];

    for (const id of structuredIds) {
      const presetPattern = new RegExp(`id:'${id}'[^}]+system:'([^']+)'[^}]+user:'([^']+)'`);
      const match = html.match(presetPattern);
      expect(match, `missing visible prompt fields for ${id}`).not.toBeNull();
      expect(match?.[1].length, `system prompt too short for ${id}`).toBeGreaterThan(40);
      expect(match?.[2].length, `user prompt too short for ${id}`).toBeGreaterThan(60);
    }

    expect(html).toContain('Return JSON only with operation, results, and corrected_text');
    expect(html).toContain('Stress test the OpenKeyboard correction-card contract');
    expect(html).toContain('one result item per issue plus corrected_text');
    expect(html).toContain('do not invent corrections');
    expect(html).toContain('2 bullet action items');
    expect(html).toContain('clear, professional, and friendly');
    expect(html).not.toContain('correction, suggestion, warning, and explanation');
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
});
