// Start only an owned gateway process with disposable state. Never reuse a local service.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export async function startGateway({ root = resolve('.'), upstreamUrl, apfelUrl, adminConfig, proofModel, keys = [] }) {
  const directory = await mkdtemp(join(tmpdir(), 'gateway-proof-'));
  let child;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      let timer;
      await Promise.race([exited, new Promise(resolveTimer => { timer = setTimeout(resolveTimer, 3000); })]);
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await mkdir(join(directory, 'config'), { mode: 0o700 });
    for (const name of ['public', 'Vendor']) await symlink(join(root, name), join(directory, name));
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise((resolveClose, reject) => reservation.close(error => error ? reject(error) : resolveClose()));
    const clientKey = randomBytes(32).toString('hex');
    const fixtureKey = { id: 'proof-key', name: 'Proof fixture', key: clientKey, enabled: true,
      allowedModels: proofModel ? [proofModel] : ['*'], rateLimitConfig: { requestsPerMinute: 600, burstAllowance: 100 },
      createdAt: '2026-01-01T00:00:00Z' };
    const config = { port, bindAddress: '127.0.0.1', ollamaHost: upstreamUrl, ...(apfelUrl ? { apfelHost: apfelUrl } : {}),
      allowLocalServiceStart: false, logLevel: 'error', corsOrigins: ['*'] };
    for (const [name, content] of Object.entries({ 'config.json': config, 'keys.json': { keys: [fixtureKey, ...keys] },
      ...(adminConfig ? { 'admin.json': adminConfig } : {}) })) {
      await writeFile(join(directory, 'config', name), JSON.stringify(content), { mode: 0o600 });
    }
    child = spawn(process.execPath, [join(root, 'dist/index.js')], {
      cwd: directory,
      env: { CONFIG_PATH: './config/config.json', KEYS_PATH: './config/keys.json', ADMIN_CONFIG_PATH: './config/admin.json' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    let spawnFailed = false;
    child.once('error', () => { spawnFailed = true; });
    const url = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnFailed || child.exitCode !== null || child.signalCode !== null) throw new Error('Owned gateway failed to start.');
      try {
        const response = await fetch(`${url}/v1/models`, { headers: { Authorization: `Bearer ${clientKey}` }, signal: AbortSignal.timeout(1000) });
        // A valid key gets past authentication even when its fixture upstream is disconnected.
        if ([200, 502, 503, 504].includes(response.status)) { await response.body?.cancel(); return { url, clientKey, directory, close }; }
        await response.body?.cancel();
      } catch {}
      await delay(50);
    }
    throw new Error('Owned gateway did not become ready.');
  } catch (error) { await close(); throw error; }
}

export function startLiveGateway({ root, profile }) {
  return startGateway({ root, proofModel: profile.model,
    upstreamUrl: profile.provider === 'ollama' ? profile.upstreamUrl : 'http://127.0.0.1:9',
    apfelUrl: profile.provider === 'apfel' ? profile.upstreamUrl : undefined });
}
