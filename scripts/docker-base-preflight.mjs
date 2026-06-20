#!/usr/bin/env node
import { spawn } from 'node:child_process';

const nodeImage = process.env.NODE_IMAGE || 'node:20-alpine';
const timeoutMs = Number(process.env.DOCKER_PREFLIGHT_TIMEOUT_MS || 15000);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      ...options,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try {
          if (process.platform !== 'win32') {
            process.kill(-child.pid, 'SIGTERM');
          } else {
            child.kill('SIGTERM');
          }
        } catch {
          child.kill('SIGKILL');
        }
      }
    }, timeoutMs);

    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) {
        const error = new Error(`Timed out after ${timeoutMs}ms`);
        error.code = 'ETIMEDOUT';
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const error = new Error(`Exited with code ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
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
  const manifest = await run('docker', ['manifest', 'inspect', nodeImage], { maxBuffer: 1024 * 1024 });
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
