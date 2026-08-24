import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apfelHostDiagnostic,
  BREW_SERVICE_CONTROL_TIMEOUT_MS,
  BREW_SERVICE_MAX_WAIT_SECONDS,
  brewServiceCommand,
  createModelServiceControllerApp,
} from '../src/models/hostController.js';
import {
  HttpModelServiceController,
  MODEL_SERVICE_CONTROL_TIMEOUT_MS,
} from '../src/models/serviceController.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('host model-service controller', () => {
  it('uses only fixed Homebrew Apfel service commands', () => {
    expect(brewServiceCommand('start', '/opt/homebrew/bin/brew')).toEqual({
      command: '/opt/homebrew/bin/brew',
      args: ['services', 'start', 'apfel'],
    });
    expect(brewServiceCommand('stop', '/opt/homebrew/bin/brew')).toEqual({
      command: '/opt/homebrew/bin/brew',
      args: ['services', 'stop', '--max-wait=20', 'apfel'],
    });
    expect(BREW_SERVICE_MAX_WAIT_SECONDS).toBe(20);
    expect(BREW_SERVICE_CONTROL_TIMEOUT_MS).toBe(25000);
    expect(MODEL_SERVICE_CONTROL_TIMEOUT_MS).toBe(30000);
    expect(BREW_SERVICE_CONTROL_TIMEOUT_MS).toBeLessThan(MODEL_SERVICE_CONTROL_TIMEOUT_MS);
  });

  it('requires authentication and exposes only fixed Apfel start/stop routes', async () => {
    const service = {
      diagnostic: vi.fn(() => ({ available: true, code: 'ready', message: 'ready', steps: [] })),
      control: vi.fn(async () => undefined),
    };
    const app = createModelServiceControllerApp('control-secret', service);

    expect((await app.request('/health')).status).toBe(401);
    expect((await app.request('/health', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);

    const headers = { Authorization: 'Bearer control-secret' };
    expect((await app.request('/health', { headers })).status).toBe(200);
    expect((await app.request('/services/apfel/start', { method: 'POST', headers })).status).toBe(200);
    expect((await app.request('/services/apfel/stop', { method: 'POST', headers })).status).toBe(200);
    expect((await app.request('/services/codex/start', { method: 'POST', headers })).status).toBe(404);
    expect(service.control.mock.calls).toEqual([['start'], ['stop']]);
  });

  it('reports graceful platform and installation guidance', () => {
    expect(apfelHostDiagnostic('linux', 'x64', true, true)).toMatchObject({
      available: false,
      code: 'unsupported_platform',
    });
    expect(apfelHostDiagnostic('darwin', 'x64', true, true)).toMatchObject({
      available: false,
      code: 'unsupported_architecture',
    });
    expect(apfelHostDiagnostic('darwin', 'arm64', false, false)).toMatchObject({
      available: false,
      code: 'homebrew_missing',
    });
    expect(apfelHostDiagnostic('darwin', 'arm64', true, false)).toMatchObject({
      available: false,
      code: 'apfel_missing',
      steps: expect.arrayContaining(['Run brew install apfel on the Mac.']),
    });
  });

  it('returns setup-required errors without executing Homebrew', async () => {
    const service = {
      diagnostic: vi.fn(() => apfelHostDiagnostic('linux', 'x64', false, false)),
      control: vi.fn(),
    };
    const app = createModelServiceControllerApp('control-secret', service);
    const headers = { Authorization: 'Bearer control-secret' };

    const health = await app.request('/health', { headers });
    expect((await health.json()).services.apfel).toMatchObject({
      available: false,
      code: 'unsupported_platform',
    });
    const start = await app.request('/services/apfel/start', { method: 'POST', headers });
    expect(start.status).toBe(409);
    expect((await start.json()).error).toMatchObject({ code: 'unsupported_platform' });
    expect(service.control).not.toHaveBeenCalled();
  });

  it('sends the protected token only to fixed controller endpoints', async () => {
    const fixtureToken = ['fixture', 'control', 'value'].join('-');
    const fixtureAuthorization = ['Bearer', fixtureToken].join(' ');
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(init?.headers).toEqual({ Authorization: fixtureAuthorization });
      if (url.endsWith('/health')) return Response.json({
        services: { apfel: { available: true, code: 'ready', message: 'ready', steps: [] } },
      });
      return Response.json({ status: 'accepted' });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const controller = new HttpModelServiceController(
      new URL('http://host.docker.internal:18777'),
      fixtureToken,
    );

    await expect(controller.diagnostic('apfel')).resolves.toMatchObject({ available: true });
    await controller.start('apfel');
    await controller.stop('apfel');
    expect(fetchSpy.mock.calls.map(([input, init]) => [String(input), init?.method])).toEqual([
      ['http://host.docker.internal:18777/health', 'GET'],
      ['http://host.docker.internal:18777/services/apfel/start', 'POST'],
      ['http://host.docker.internal:18777/services/apfel/stop', 'POST'],
    ]);
  });
});
