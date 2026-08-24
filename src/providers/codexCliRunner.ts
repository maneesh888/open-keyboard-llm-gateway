import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export type CodexRunInput = {
  prompt: string;
  model: string;
  apiKey: string;
  maxOutputChars: number;
  signal: AbortSignal;
};

export interface CodexRunner {
  isAvailable(): boolean;
  run(input: CodexRunInput): Promise<string>;
}

export type CodexRunnerErrorKind = 'unavailable' | 'cancelled' | 'invalid_output' | 'execution_failed';

export class CodexRunnerError extends Error {
  constructor(readonly kind: CodexRunnerErrorKind) {
    super('Codex execution failed.');
    this.name = 'CodexRunnerError';
  }
}

const PLATFORM_PACKAGES: Record<string, string> = {
  'darwin:arm64': '@openai/codex-darwin-arm64',
  'darwin:x64': '@openai/codex-darwin-x64',
  'linux:arm64': '@openai/codex-linux-arm64',
  'linux:x64': '@openai/codex-linux-x64',
  'win32:arm64': '@openai/codex-win32-arm64',
  'win32:x64': '@openai/codex-win32-x64',
};

const TARGET_TRIPLES: Record<string, string> = {
  'darwin:arm64': 'aarch64-apple-darwin',
  'darwin:x64': 'x86_64-apple-darwin',
  'linux:arm64': 'aarch64-unknown-linux-musl',
  'linux:x64': 'x86_64-unknown-linux-musl',
  'win32:arm64': 'aarch64-pc-windows-msvc',
  'win32:x64': 'x86_64-pc-windows-msvc',
};

export function codexPlatformSupported(platform = process.platform, arch = process.arch): boolean {
  return Boolean(PLATFORM_PACKAGES[`${platform}:${arch}`] && TARGET_TRIPLES[`${platform}:${arch}`]);
}

function resolveCodexExecutable(): string | undefined {
  const platformKey = `${process.platform}:${process.arch}`;
  const packageName = PLATFORM_PACKAGES[platformKey];
  const targetTriple = TARGET_TRIPLES[platformKey];
  if (!packageName || !targetTriple) return undefined;

  try {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve(`${packageName}/package.json`);
    const executable = join(
      dirname(packagePath),
      'vendor',
      targetTriple,
      'bin',
      process.platform === 'win32' ? 'codex.exe' : 'codex',
    );
    return existsSync(executable) ? executable : undefined;
  } catch {
    return undefined;
  }
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams): NodeJS.Timeout | undefined {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return undefined;

  const signal = (name: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, name);
      else child.kill(name);
    } catch {}
  };

  signal('SIGTERM');
  const timer = setTimeout(() => signal('SIGKILL'), 1000);
  timer.unref();
  return timer;
}

export class CodexCliRunner implements CodexRunner {
  private readonly executable?: string;

  constructor(options: { executable?: string } = {}) {
    this.executable = options.executable || resolveCodexExecutable();
  }

  isAvailable(): boolean {
    return Boolean(this.executable);
  }

  async run(input: CodexRunInput): Promise<string> {
    if (!this.executable) throw new CodexRunnerError('unavailable');
    if (input.signal.aborted) throw new CodexRunnerError('cancelled');

    const invocationRoot = await mkdtemp(join(tmpdir(), 'llm-gateway-codex-'));
    const codexHome = join(invocationRoot, 'home');
    const workingDirectory = join(invocationRoot, 'work');

    try {
      await mkdir(codexHome, { mode: 0o700 });
      await mkdir(workingDirectory, { mode: 0o700 });
      if (input.signal.aborted) throw new CodexRunnerError('cancelled');
      await this.authenticate(input, codexHome, workingDirectory);
      if (input.signal.aborted) throw new CodexRunnerError('cancelled');
      return await this.runIsolated(input, codexHome, workingDirectory);
    } finally {
      await rm(invocationRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private authenticate(input: CodexRunInput, codexHome: string, workingDirectory: string): Promise<void> {
    const child = spawn(this.executable!, codexLoginArguments(), {
      cwd: workingDirectory,
      detached: process.platform !== 'win32',
      env: codexEnvironment(codexHome),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return new Promise<void>((resolve, reject) => {
      const outputLimit = 32768;
      let outputBytes = 0;
      let failure: CodexRunnerError | undefined;
      let killTimer: NodeJS.Timeout | undefined;

      const fail = (kind: CodexRunnerErrorKind) => {
        if (failure) return;
        failure = new CodexRunnerError(kind);
        killTimer = terminateProcessTree(child);
      };
      const countOutput = (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > outputLimit) fail('execution_failed');
      };

      child.stdout.on('data', countOutput);
      child.stderr.on('data', countOutput);
      child.once('error', () => fail('unavailable'));
      child.stdin.once('error', () => fail('execution_failed'));

      const onAbort = () => fail('cancelled');
      input.signal.addEventListener('abort', onAbort, { once: true });
      if (input.signal.aborted) onAbort();

      child.once('close', (code, signal) => {
        input.signal.removeEventListener('abort', onAbort);
        if (killTimer) clearTimeout(killTimer);
        if (failure) {
          reject(failure);
          return;
        }
        if (code !== 0 || signal) {
          reject(new CodexRunnerError('unavailable'));
          return;
        }
        resolve();
      });

      child.stdin.end(input.apiKey, 'utf8');
    });
  }

  private runIsolated(input: CodexRunInput, codexHome: string, workingDirectory: string): Promise<string> {
    const args = codexArguments(input.model, workingDirectory);

    const child = spawn(this.executable!, args, {
      detached: process.platform !== 'win32',
      env: codexEnvironment(codexHome),
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return new Promise<string>((resolve, reject) => {
      const stdoutLimit = Math.min(input.maxOutputChars * 4 + 131072, 600000);
      const stderrLimit = 32768;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdoutBuffer = '';
      let finalResponse: string | undefined;
      let turnCompleted = false;
      let failure: CodexRunnerError | undefined;
      let killTimer: NodeJS.Timeout | undefined;

      const fail = (kind: CodexRunnerErrorKind) => {
        if (failure) return;
        failure = new CodexRunnerError(kind);
        killTimer = terminateProcessTree(child);
      };

      const parseLine = (line: string) => {
        if (!line.trim()) return;
        let event: unknown;
        try {
          event = JSON.parse(line) as unknown;
        } catch {
          fail('invalid_output');
          return;
        }
        if (typeof event !== 'object' || event === null || Array.isArray(event)) return;
        const record = event as Record<string, unknown>;
        const item = typeof record.item === 'object' && record.item !== null && !Array.isArray(record.item)
          ? record.item as Record<string, unknown>
          : undefined;
        if (record.type === 'item.completed' && item?.type === 'agent_message') {
          if (typeof item.text !== 'string' || item.text.length > input.maxOutputChars) {
            fail('invalid_output');
            return;
          }
          finalResponse = item.text;
        }
        if (record.type === 'turn.completed') turnCompleted = true;
        if (record.type === 'turn.failed' || record.type === 'error') fail('execution_failed');
      };

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > stdoutLimit) {
          fail('invalid_output');
          return;
        }
        stdoutBuffer += chunk.toString('utf8');
        let newline = stdoutBuffer.indexOf('\n');
        while (newline >= 0) {
          parseLine(stdoutBuffer.slice(0, newline));
          stdoutBuffer = stdoutBuffer.slice(newline + 1);
          newline = stdoutBuffer.indexOf('\n');
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > stderrLimit) fail('execution_failed');
      });

      child.once('error', () => fail('unavailable'));
      const onAbort = () => fail('cancelled');
      input.signal.addEventListener('abort', onAbort, { once: true });
      if (input.signal.aborted) onAbort();

      child.once('close', (code, signal) => {
        input.signal.removeEventListener('abort', onAbort);
        if (killTimer) clearTimeout(killTimer);
        if (stdoutBuffer) parseLine(stdoutBuffer);
        if (failure) {
          reject(failure);
          return;
        }
        if (code !== 0 || signal || !turnCompleted || typeof finalResponse !== 'string' || !finalResponse.trim()) {
          reject(new CodexRunnerError(code === 127 ? 'unavailable' : 'invalid_output'));
          return;
        }
        resolve(finalResponse);
      });

      child.stdin.once('error', () => fail('execution_failed'));
      child.stdin.end(input.prompt, 'utf8');
    });
  }
}

export function codexLoginArguments(): string[] {
  return ['login', '--with-api-key'];
}

export function codexArguments(model: string, workingDirectory: string): string[] {
  return [
    'exec',
    '--strict-config',
    '--json',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--cd',
    workingDirectory,
    '--model',
    model,
    '--config',
    'approval_policy="never"',
    '--config',
    'web_search="disabled"',
    '--config',
    'tools.web_search=false',
    '--config',
    'features.view_image=false',
    '--config',
    'features.image_generation=false',
    '--config',
    'features.apps=false',
    '--config',
    'features.hooks=false',
    '--config',
    'features.memories=false',
    '--config',
    'features.multi_agent=false',
    '--config',
    'features.goals=false',
    '--config',
    'features.network_proxy=false',
    '--config',
    'features.remote_plugin=false',
    '--config',
    'features.code_mode.enabled=false',
    '--config',
    'features.shell_snapshot=false',
    '--config',
    'features.shell_tool=false',
    '--config',
    'features.unified_exec=false',
    '--config',
    'features.skill_mcp_dependency_install=false',
    '--config',
    'agents.enabled=false',
    '--config',
    'apps._default.enabled=false',
    '--config',
    'allow_login_shell=false',
    '--config',
    'shell_environment_policy.inherit="none"',
    '-',
  ];
}

export function codexEnvironment(codexHome: string): Record<string, string> {
  return {
    CODEX_HOME: codexHome,
    CODEX_SQLITE_HOME: codexHome,
    HOME: codexHome,
    LANG: 'C.UTF-8',
    NO_COLOR: '1',
    PATH: process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin:/bin',
  };
}
