import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Hono } from 'hono';
import type { ModelServiceDiagnostic } from './serviceController.js';

export type BrewServiceAction = 'start' | 'stop';

export const BREW_SERVICE_MAX_WAIT_SECONDS = 20;
export const BREW_SERVICE_CONTROL_TIMEOUT_MS = 25000;

export type BrewServiceCommand = {
  command: string;
  args: string[];
};

export interface ApfelServiceManager {
  diagnostic(): ModelServiceDiagnostic;
  control(action: BrewServiceAction): Promise<void>;
}

function resolveBrewExecutable(): string | undefined {
  return ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'].find(existsSync);
}

export function brewServiceCommand(action: BrewServiceAction, executable = resolveBrewExecutable()): BrewServiceCommand {
  if (!executable) throw new Error('Homebrew is unavailable.');
  return {
    command: executable,
    args: action === 'start'
      ? ['services', 'start', 'apfel']
      : ['services', 'stop', `--max-wait=${BREW_SERVICE_MAX_WAIT_SECONDS}`, 'apfel'],
  };
}

export class BrewApfelServiceManager implements ApfelServiceManager {
  diagnostic(): ModelServiceDiagnostic {
    return apfelHostDiagnostic();
  }

  control(action: BrewServiceAction): Promise<void> {
    const spec = brewServiceCommand(action);
    return new Promise<void>((resolve, reject) => {
      const child = spawn(spec.command, spec.args, {
        shell: false,
        stdio: 'ignore',
        env: {
          HOME: process.env.HOME,
          LANG: process.env.LANG,
          PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
          TMPDIR: process.env.TMPDIR,
          USER: process.env.USER,
        },
      });
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Timed out while asking Homebrew to ${action} Apfel.`));
      }, BREW_SERVICE_CONTROL_TIMEOUT_MS);
      timeout.unref();
      child.once('error', () => {
        clearTimeout(timeout);
        reject(new Error('Homebrew could not be executed.'));
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error(`Homebrew could not ${action} Apfel.`));
      });
    });
  }
}

export function apfelHostDiagnostic(
  platform = process.platform,
  arch = process.arch,
  brewAvailable = Boolean(resolveBrewExecutable()),
  apfelAvailable = existsSync('/opt/homebrew/bin/apfel') || existsSync('/usr/local/bin/apfel'),
): ModelServiceDiagnostic {
  if (platform !== 'darwin') {
    return {
      available: false,
      code: 'unsupported_platform',
      message: `Apfel requires macOS 26 or newer; this controller is running on ${platform}.`,
      steps: ['Run the model-service controller on the Apple Silicon Mac that hosts Apfel.'],
    };
  }
  if (arch !== 'arm64') {
    return {
      available: false,
      code: 'unsupported_architecture',
      message: `Apfel requires Apple Silicon; this controller is running on ${arch}.`,
      steps: ['Run the controller on an Apple Silicon Mac with Apple Intelligence enabled.'],
    };
  }
  if (!brewAvailable) {
    return {
      available: false,
      code: 'homebrew_missing',
      message: 'Homebrew is not installed in a supported location.',
      steps: ['Install Homebrew from https://brew.sh.', 'Restart the model-service controller.'],
    };
  }
  if (!apfelAvailable) {
    return {
      available: false,
      code: 'apfel_missing',
      message: 'The Apfel CLI is not installed.',
      steps: ['Run brew install apfel on the Mac.', 'Configure APFEL_PORT=11435 for the Homebrew service when Ollama uses port 11434.', 'Run Check again.'],
    };
  }
  return { available: true, code: 'ready', message: 'Apfel host service control is ready.', steps: [] };
}

function validBearer(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createModelServiceControllerApp(
  token: string,
  service: ApfelServiceManager = new BrewApfelServiceManager(),
) {
  if (!token) throw new Error('A model-service control token is required.');
  const app = new Hono();

  app.use('*', async (c, next) => {
    if (!validBearer(c.req.header('Authorization'), token)) {
      return c.json({ error: { code: 'unauthorized', message: 'Authentication required.' } }, 401);
    }
    await next();
  });

  app.get('/health', (c) => c.json({ status: 'ok', services: { apfel: service.diagnostic() } }));

  app.post('/services/apfel/start', async (c) => {
    const diagnostic = service.diagnostic();
    if (!diagnostic.available) return c.json({ error: { code: diagnostic.code, message: diagnostic.message } }, 409);
    try {
      await service.control('start');
      return c.json({ status: 'accepted', service: 'apfel', action: 'start' });
    } catch {
      return c.json({ error: { code: 'service_control_failed', message: 'Apfel could not be started.' } }, 503);
    }
  });

  app.post('/services/apfel/stop', async (c) => {
    const diagnostic = service.diagnostic();
    if (!diagnostic.available) return c.json({ error: { code: diagnostic.code, message: diagnostic.message } }, 409);
    try {
      await service.control('stop');
      return c.json({ status: 'accepted', service: 'apfel', action: 'stop' });
    } catch {
      return c.json({ error: { code: 'service_control_failed', message: 'Apfel could not be stopped.' } }, 503);
    }
  });

  return app;
}
