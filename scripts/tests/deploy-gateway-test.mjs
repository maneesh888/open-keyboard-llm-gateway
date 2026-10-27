import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  TARGETS,
  buildContainerCreateBody,
  parseArgs,
  sanitizedEvidence,
  validatePhoneReleaseMetadata,
} from '../deploy-gateway.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SHA = 'a'.repeat(40);

test('deployment targets are environments, not backend modes', () => {
  assert.deepEqual(Object.keys(TARGETS), ['mac-staging', 'oneplus7t-production']);
  assert.equal(TARGETS['mac-staging'].kind, 'docker');
  assert.equal(TARGETS['oneplus7t-production'].kind, 'phone');
});

test('apply requires one environment and exact environment/revision confirmation', () => {
  assert.throws(() => parseArgs(['--revision', SHA]), /environment/);
  assert.throws(() => parseArgs(['--environment', 'mac-staging', '--revision', SHA, '--apply']), /confirm/);
  const parsed = parseArgs([
    '--environment', 'mac-staging', '--revision', SHA, '--apply', '--confirm', `mac-staging:${SHA}`,
  ]);
  assert.equal(parsed.apply, true);
  assert.throws(() => parseArgs([
    '--environment', 'oneplus7t-production', '--revision', SHA, '--apply',
    '--confirm', `oneplus7t-production:${SHA}`,
  ]), /artifact/);
});

test('container recreation changes only image and revision label while retaining runtime configuration', () => {
  const inspect = {
    Config: {
      Env: ['SECRET_VALUE=not-logged'],
      Cmd: ['node', 'dist/index.js'],
      Labels: { existing: 'kept', 'org.opencontainers.image.revision': 'old' },
      ExposedPorts: { '8080/tcp': {} },
    },
    HostConfig: {
      Binds: ['/private/config:/app/config:ro'],
      PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8880' }] },
      RestartPolicy: { Name: 'unless-stopped' },
      SecurityOpt: ['no-new-privileges'],
      NetworkMode: 'gateway-net',
    },
  };
  const body = buildContainerCreateBody(inspect, `llm-gateway:git-${SHA}`, SHA);
  assert.equal(body.Image, `llm-gateway:git-${SHA}`);
  assert.deepEqual(body.Env, inspect.Config.Env);
  assert.equal(body.HostConfig, inspect.HostConfig);
  assert.equal(body.Labels.existing, 'kept');
  assert.equal(body.Labels['org.opencontainers.image.revision'], SHA);
});

test('sanitized evidence contains no runtime configuration, mount paths, hosts, or secret values', () => {
  const evidence = sanitizedEvidence({
    environment: 'mac-staging', revision: SHA, outcome: 'deployed',
    checks: { health: true, ui: true, unauthorizedModels: true, configurationPreserved: true },
  });
  const encoded = JSON.stringify(evidence);
  assert.equal(encoded.includes('/private/config'), false);
  assert.equal(encoded.includes('SECRET_VALUE'), false);
  assert.equal(encoded.includes('192.168.'), false);
});

test('phone metadata is bound to exact revision and native target', () => {
  assert.equal(validatePhoneReleaseMetadata({
    git_revision: SHA,
    target: 'existing phone Linux arm64 Node 24 runtime',
  }, SHA), true);
  assert.throws(() => validatePhoneReleaseMetadata({ git_revision: 'b'.repeat(40), target: 'existing phone Linux arm64 Node 24 runtime' }, SHA));
});

test('phone installer preserves configuration, override, locking, checks, and rollback', () => {
  const installer = readFileSync(path.join(ROOT, 'scripts/deploy/phone-install.sh'), 'utf8');
  for (const required of [
    'mkdir "$lock_dir"',
    'config_fingerprint "$config_before"',
    'cmp -s "$config_before" "$config_after"',
    'cmp -s "$app_root/KEEPALIVE_OVERRIDE.json" "$candidate/KEEPALIVE_OVERRIDE.json"',
    'status_code "$base_url/health"',
    'status_code "$base_url/ui"',
    'status_code "$base_url/v1/models"',
    'rollback()',
    'mv "$backup" "$app_root"',
    'trap interrupted HUP INT TERM',
    "raise SystemExit('privileged archive mode')",
  ]) assert.equal(installer.includes(required), true, `missing ${required}`);
});

test('Mac deploy path registers interruption rollback before swapping containers', () => {
  const deployer = readFileSync(path.join(ROOT, 'scripts/deploy-gateway.mjs'), 'utf8');
  assert.equal(deployer.includes("process.once('SIGINT', interrupted)"), true);
  assert.equal(deployer.includes("process.once('SIGTERM', interrupted)"), true);
  assert.equal(deployer.includes("return 'restored-previous-container'"), true);
  assert.equal(deployer.includes("rollback = 'restarted-previous-container'"), true);
});
