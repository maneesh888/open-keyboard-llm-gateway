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
    expect(html).toContain('function renderTesterKeys()');
    expect(html).toContain('function getFullKey(id)');
    expect(html).toContain('api(`/admin/keys/${id}`)');
    expect(html).toContain("fetch('/v1/chat/completions'");
    expect(html).toContain('function classify(status,data,err)');
    expect(html).toContain('history.replaceState(null');
    expect(html).toContain(`onclick="navigateTo('keys')"`);
    expect(html).toContain('class="mobile-tabs"');
    expect(html).toContain('class="mobile-tab" data-page="playground"');
    expect(html).toContain("document.querySelectorAll('.nav-pill,.mobile-tab')");
  });


  it('normalizes invalid admin routes after login and exposes active nav state', () => {
    expect(html).toContain('needsNormalize');
    expect(html).toContain("if(parseRoute().needsNormalize)history.replaceState(null,'',routeFor('keys'))");
    expect(html).toContain("if(route.needsNormalize&&authToken)history.replaceState(null,'',routeFor(route.page,route.keyId))");
    expect(html).toContain("b.setAttribute('aria-current',active?'page':'false')");
  });

  it('uses model selector with manual fallback for key creation/editing', () => {
    expect(html).toContain("api('/admin/models'");
    expect(html).toContain('id="keyModel"');
    expect(html).toContain("onchange=\"syncManualModel('key')\"");
    expect(html).toContain('function syncManualModel(prefix)');
    expect(html).toContain('function preferredModel()');
    expect(html).toContain("const preferredModelOrder=['gpt-oss:120b-cloud','gemma4:latest','llama3.2:latest']");
    expect(html).toContain('populateModelSelect(keyModel);keyModelManual.classList.add');
    expect(html).not.toContain('populateModelSelect(keyModel,availableModels[0])');
    expect(html).toContain('Custom / manual…');
  });
});
