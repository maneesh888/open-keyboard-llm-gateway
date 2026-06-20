#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const nodeImage = process.env.NODE_IMAGE || 'node:20-alpine';
const timeoutMs = Number(process.env.DOCKER_PREFLIGHT_TIMEOUT_MS || 15000);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    ...options,
  }).trim();
}

function fail(message, details = '') {
  console.error(`docker-base-preflight: FAIL: ${message}`);
  if (details) console.error(details.trim());
  process.exit(1);
}

function pass(message) {
  console.log(`docker-base-preflight: OK: ${message}`);
}

try {
  run('docker', ['info', '--format', '{{.ServerVersion}}']);
} catch (error) {
  fail('Docker daemon is unavailable or too slow to answer docker info.', error.stderr || error.message);
}

try {
  const localId = run('docker', ['image', 'inspect', nodeImage, '--format', '{{.Id}}']);
  pass(`base image is already available locally: ${nodeImage} ${localId.slice(0, 20)}…`);
  process.exit(0);
} catch (error) {
  // Continue to remote metadata check below.
}

try {
  const digest = run('docker', ['manifest', 'inspect', nodeImage], { maxBuffer: 1024 * 1024 });
  JSON.parse(digest);
  pass(`Docker registry metadata is reachable for ${nodeImage}. Base image is not local; build may still need to pull layers.`);
  process.exit(0);
} catch (error) {
  const detail = error.signal === 'SIGTERM'
    ? `Timed out after ${timeoutMs}ms while checking registry metadata for ${nodeImage}.`
    : (error.stderr || error.message);
  fail(
    `base image ${nodeImage} is not local and registry metadata could not be retrieved quickly. `
      + 'This points to Docker Hub/network/host Docker auth or proxy state, not app source.',
    detail,
  );
}
