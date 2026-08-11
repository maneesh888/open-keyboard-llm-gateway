#!/usr/bin/env node
import { spawn } from 'node:child_process';
const nodeImage = process.env.NODE_IMAGE || 'node:24-alpine';
const timeoutMs = Number(process.env.DOCKER_PREFLIGHT_TIMEOUT_MS || 15000);
const killGraceMs = Number(process.env.DOCKER_PREFLIGHT_KILL_GRACE_MS || 2000);

function signalChild(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform !== 'win32') {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Process may have already exited.
    }
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      ...options,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killTimer;

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      callback(value);
    };

    const timeoutError = () => {
      const error = new Error(`Timed out after ${timeoutMs}ms`);
      error.code = 'ETIMEDOUT';
      error.stdout = stdout;
      error.stderr = stderr;
      return error;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      signalChild(child, 'SIGTERM');
      killTimer = setTimeout(() => {
        signalChild(child, 'SIGKILL');
        settle(reject, timeoutError());
      }, killGraceMs);
    }, timeoutMs);

    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      settle(reject, error);
    });
    child.on('close', code => {
      if (timedOut) {
        settle(reject, timeoutError());
        return;
      }
      if (code === 0) {
        settle(resolve, stdout.trim());
        return;
      }
      const error = new Error(`Exited with code ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      settle(reject, error);
    });
  });
}

function fail(message, details = '') {
  console.error(`docker-base-preflight: FAIL: ${message}`);
  if (details) console.error(String(details).trim());
  process.exit(1);
}

function pass(message) {
  console.log(`docker-base-preflight: OK: ${message}`);
}

async function runSimulatedHang() {
  const started = Date.now();
  try {
    await run(process.execPath, [
      '-e',
      'process.on("SIGTERM",()=>{}); setInterval(()=>{}, 1000);',
    ]);
    fail('simulated hang unexpectedly exited successfully.');
  } catch (error) {
    const elapsed = Date.now() - started;
    if (error.code !== 'ETIMEDOUT') {
      fail('simulated hang returned an unexpected error.', error.message);
    }
    const upperBound = timeoutMs + killGraceMs + 1500;
    if (elapsed > upperBound) {
      fail(`simulated hang cleanup exceeded expected bound (${elapsed}ms > ${upperBound}ms).`);
    }
    pass(`simulated hung child was terminated in ${elapsed}ms (timeout ${timeoutMs}ms, grace ${killGraceMs}ms).`);
  }
}

if (process.env.DOCKER_PREFLIGHT_SIMULATE_HANG === '1') {
  await runSimulatedHang();
  process.exit(0);
}

try {
  await run('docker', ['info', '--format', '{{.ServerVersion}}']);
} catch (error) {
  fail('Docker daemon is unavailable or too slow to answer docker info.', error.stderr || error.message);
}

try {
  const localId = await run('docker', ['image', 'inspect', nodeImage, '--format', '{{.Id}}']);
  pass(`base image is already available locally: ${nodeImage} ${localId.slice(0, 20)}…`);
  process.exit(0);
} catch {
  // Continue to remote metadata check below.
}

try {
  const manifest = await run('docker', ['manifest', 'inspect', nodeImage]);
  JSON.parse(manifest);
  pass(`Docker registry metadata is reachable for ${nodeImage}. Base image is not local; build may still need to pull layers.`);
  process.exit(0);
} catch (error) {
  const detail = error.code === 'ETIMEDOUT'
    ? `Timed out after ${timeoutMs}ms while checking registry metadata for ${nodeImage}.`
    : (error.stderr || error.message);
  fail(
    `base image ${nodeImage} is not local and registry metadata could not be retrieved quickly. `
      + 'This points to Docker Hub/network/host Docker auth or proxy state, not app source.',
    detail,
  );
}
