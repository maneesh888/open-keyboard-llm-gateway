#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const DEFAULT_PORT = 8080;
const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2:latest';
const MIN_ADMIN_PASSWORD_LENGTH = 12;

const paths = {
  configDir: resolve('config'),
  appConfig: resolve('config/config.json'),
  adminConfig: resolve('config/admin.json'),
  keysConfig: resolve('config/keys.json'),
};

function usage() {
  console.log(`Usage:
  npm run bootstrap
  npm run dev:bootstrap
  npm run bootstrap -- --model llama3.2:latest --pull

Creates missing local runtime config files and installs npm dependencies.
Existing config files are left unchanged.

Options:
  --skip-install            Do not run npm install before setup
  --admin-user <name>       Admin UI username to create (default: admin)
  --admin-password <value>  Admin UI password; prefer LLM_GATEWAY_ADMIN_PASSWORD
  --model <name>            Default model for the generated local API key
  --pull                    Pull the selected model with the ollama CLI
  --serve                   Start the local gateway after setup completes
  --ollama-host <url>       Ollama host for config/config.json
  --port <number>           Gateway port for config/config.json
  --help                    Show this help

Environment:
  LLM_GATEWAY_ADMIN_PASSWORD  Admin UI password for non-interactive setup
  OLLAMA_HOST                 Default Ollama host when --ollama-host is omitted
  PORT                        Default gateway port when --port is omitted
`);
}

function parseArgs(argv) {
  const options = {
    adminUser: 'admin',
    adminPassword: process.env.LLM_GATEWAY_ADMIN_PASSWORD || '',
    model: process.env.LLM_GATEWAY_MODEL || DEFAULT_MODEL,
    ollamaHost: process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST,
    port: process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT,
    pull: false,
    serve: false,
    skipInstall: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = (name) => {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${name} requires a value`);
      }
      i += 1;
      return value;
    };

    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--skip-install') options.skipInstall = true;
    else if (arg === '--pull') options.pull = true;
    else if (arg === '--serve') options.serve = true;
    else if (arg === '--admin-user') options.adminUser = readValue(arg);
    else if (arg === '--admin-password') options.adminPassword = readValue(arg);
    else if (arg === '--model') options.model = readValue(arg);
    else if (arg === '--ollama-host') options.ollamaHost = readValue(arg);
    else if (arg === '--port') options.port = Number(readValue(arg));
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('--port must be an integer between 1 and 65535');
  }

  options.adminUser = options.adminUser.trim();
  options.model = options.model.trim();
  options.ollamaHost = normalizeUrl(options.ollamaHost, 'ollama host');

  if (!options.adminUser) throw new Error('--admin-user must not be empty');
  if (!options.model) throw new Error('--model must not be empty');

  return options;
}

function normalizeUrl(value, label) {
  if (!value || typeof value !== 'string') throw new Error(`${label} must be a URL`);
  const trimmed = value.trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error(`${label} must be a valid http or https URL`);
  }
  return trimmed;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    ...options,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

async function readJsonIfPresent(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

async function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Admin password is required. Set LLM_GATEWAY_ADMIN_PASSWORD or pass --admin-password for non-interactive setup.');
  }

  return new Promise((resolveValue, reject) => {
    const stdin = process.stdin;
    const wasRaw = Boolean(stdin.isRaw);
    let value = '';

    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };

    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      for (const char of text) {
        if (char === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          reject(new Error('Setup cancelled'));
          return;
        }
        if (char === '\r' || char === '\n' || char === '\u0004') {
          cleanup();
          process.stdout.write('\n');
          resolveValue(value);
          return;
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= ' ') value += char;
      }
    };

    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function getAdminPassword(providedPassword) {
  if (providedPassword) {
    assertStrongPassword(providedPassword);
    return providedPassword;
  }

  for (;;) {
    const password = await readHidden('Admin UI password (input hidden): ');
    assertStrongPassword(password);
    const confirmation = await readHidden('Confirm admin UI password: ');
    if (password === confirmation) return password;
    console.log('Passwords did not match. Try again.');
  }
}

function assertStrongPassword(password) {
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(`Admin password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
  }
}

async function ensureDependencies(options) {
  if (options.skipInstall) {
    console.log('[bootstrap] Skipping npm install.');
    return;
  }

  console.log('[bootstrap] Installing npm dependencies...');
  run(npmCommand(), ['install']);
}

async function ensureAppConfig(options) {
  const existing = await readJsonIfPresent(paths.appConfig);
  if (existing) {
    console.log('[bootstrap] Existing config/config.json left unchanged.');
    return existing;
  }

  const config = {
    port: options.port,
    ollamaHost: options.ollamaHost,
    logLevel: 'info',
    corsOrigins: ['*'],
  };

  await writeJson(paths.appConfig, config);
  console.log(`[bootstrap] Created config/config.json for ${config.ollamaHost}.`);
  return config;
}

async function ensureAdminConfig(options) {
  const existing = await readJsonIfPresent(paths.adminConfig);
  if (existing) {
    console.log('[bootstrap] Existing config/admin.json left unchanged.');
    return;
  }

  const password = await getAdminPassword(options.adminPassword);
  const bcryptModule = await import('bcryptjs');
  const bcrypt = bcryptModule.default || bcryptModule;
  const now = new Date().toISOString();
  const adminConfig = {
    users: [
      {
        username: options.adminUser,
        passwordHash: await bcrypt.hash(password, 12),
        createdAt: now,
      },
    ],
    jwtSecret: randomBytes(48).toString('base64url'),
    sessionExpiryHours: 24,
  };

  await writeJson(paths.adminConfig, adminConfig);
  console.log(`[bootstrap] Created config/admin.json for admin user "${options.adminUser}".`);
}

async function ensureKeysConfig(options) {
  const existing = await readJsonIfPresent(paths.keysConfig);
  if (existing) {
    console.log('[bootstrap] Existing config/keys.json left unchanged.');
    return;
  }

  const now = new Date().toISOString();
  const keysConfig = {
    keys: [
      {
        id: `key_bootstrap_${randomBytes(4).toString('hex')}`,
        name: 'Local Bootstrap Key',
        key: `sk-${randomBytes(24).toString('hex')}`,
        enabled: true,
        rateLimitConfig: {
          requestsPerMinute: 30,
          burstAllowance: 10,
        },
        allowedModels: ['*'],
        features: {
          suggestions: true,
          customActions: [],
        },
        modelConfig: {
          model: options.model,
          maxTokens: 100,
          temperature: 0.7,
        },
        owner: 'local',
        description: 'Generated by npm run bootstrap.',
        createdAt: now,
        updatedAt: now,
      },
    ],
  };

  await writeJson(paths.keysConfig, keysConfig);
  console.log(`[bootstrap] Created config/keys.json with one enabled key using model "${options.model}".`);
}

async function checkOllama(host) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(new URL('/api/tags', host), { signal: controller.signal });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, error };
  } finally {
    clearTimeout(timeout);
  }
}

function pullModel(options) {
  if (!options.pull) return;
  console.log(`[bootstrap] Pulling Ollama model "${options.model}"...`);
  run('ollama', ['pull', options.model], {
    env: {
      ...process.env,
      OLLAMA_HOST: options.ollamaHost,
    },
  });
}

function startGateway(appConfig, options) {
  const port = appConfig.port || options.port;
  console.log(`[bootstrap] Starting local gateway at http://localhost:${port}/ui`);
  console.log('[bootstrap] Press Ctrl-C to stop the gateway.');
  run(npmCommand(), ['run', 'dev']);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  await mkdir(paths.configDir, { recursive: true });
  await ensureDependencies(options);
  const appConfig = await ensureAppConfig(options);
  await ensureAdminConfig(options);
  await ensureKeysConfig(options);
  pullModel({ ...options, ollamaHost: appConfig.ollamaHost || options.ollamaHost });

  const ollama = await checkOllama(appConfig.ollamaHost || options.ollamaHost);
  if (ollama.ok) {
    console.log(`[bootstrap] Ollama is reachable at ${appConfig.ollamaHost || options.ollamaHost}.`);
  } else {
    console.log(`[bootstrap] Ollama was not reachable at ${appConfig.ollamaHost || options.ollamaHost}. Start Ollama before running live model tests.`);
  }

  console.log(`Open: http://localhost:${appConfig.port || options.port}/ui`);
  console.log('Use the admin username and password you configured. API keys can be revealed or copied inside the admin UI.');

  if (options.serve) {
    startGateway(appConfig, options);
    return;
  }

  console.log('[bootstrap] Setup complete.');
  console.log(`Next: npm run dev`);
}

main().catch((error) => {
  console.error(`[bootstrap] ${error.message}`);
  process.exit(1);
});
