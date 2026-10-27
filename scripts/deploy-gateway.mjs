#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const TARGETS = Object.freeze({
  'mac-staging': Object.freeze({
    kind: 'docker',
    container: 'llm-gateway',
    imageRepository: 'llm-gateway',
    baseUrl: 'http://127.0.0.1:8880',
  }),
  'oneplus7t-production': Object.freeze({
    kind: 'phone',
    sshTarget: 'server@192.168.1.130',
    hostKeyAlias: '172.16.42.1',
    baseUrl: 'http://192.168.1.130:8880',
    service: 'oneplus-llm',
  }),
});

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const FULL_SHA = /^[0-9a-f]{40}$/;

function usage() {
  return `Usage:
  node scripts/deploy-gateway.mjs --environment <name> --revision <full-sha> [options]

Environments:
  mac-staging             Local Docker container on 127.0.0.1:8880
  oneplus7t-production    Native OpenRC bundle on server@192.168.1.130

The default is a read-only plan. Applying is deliberately separate:
  --apply --confirm <environment>:<full-sha>

Mac options:
  --image <reference>     Existing revision-labelled image
  --build                 Build llm-gateway:git-<full-sha> from an exact clean checkout

Phone options:
  --artifact <tar.gz>     Revision-labelled app bundle with app/RELEASE.json
  --ssh-identity <path>   Private SSH identity (path only; never copied)
  --known-hosts <path>    Pinned known_hosts file

No command here publishes an image, changes DNS/tunnels, or deploys both targets at once.`;
}

export function parseArgs(argv) {
  const options = { apply: false, build: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') options.apply = true;
    else if (argument === '--build') options.build = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (['--environment', '--revision', '--confirm', '--image', '--artifact', '--ssh-identity', '--known-hosts'].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      options[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
      index += 1;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.help) return options;
  if (!TARGETS[options.environment]) throw new Error('Select exactly one known --environment.');
  if (!FULL_SHA.test(options.revision || '')) throw new Error('--revision must be a full lowercase 40-character Git SHA.');
  if (options.apply && options.confirm !== `${options.environment}:${options.revision}`) {
    throw new Error(`Apply requires --confirm ${options.environment}:${options.revision}`);
  }
  if (!options.apply && options.confirm) throw new Error('--confirm is accepted only with --apply.');
  if (options.build && options.environment !== 'mac-staging') throw new Error('--build is only valid for mac-staging.');
  if (options.image && options.environment !== 'mac-staging') throw new Error('--image is only valid for mac-staging.');
  if (options.artifact && options.environment !== 'oneplus7t-production') throw new Error('--artifact is only valid for oneplus7t-production.');
  if (options.apply && options.environment === 'oneplus7t-production') {
    for (const required of ['artifact', 'sshIdentity', 'knownHosts']) {
      if (!options[required]) throw new Error(`Phone apply requires --${required.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}.`);
    }
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    env: options.env || process.env,
  });
  if (result.error || result.status !== 0) {
    const error = new Error(options.failure || `${command} failed.`);
    error.status = result.status;
    throw error;
  }
  return options.inherit ? '' : result.stdout.trim();
}

function git(args) {
  return run('git', ['-C', ROOT, ...args], { failure: 'Git preflight failed.' });
}

export function buildContainerCreateBody(inspect, image, revision) {
  const configKeys = [
    'Hostname', 'Domainname', 'User', 'AttachStdin', 'AttachStdout', 'AttachStderr', 'ExposedPorts',
    'Tty', 'OpenStdin', 'StdinOnce', 'Env', 'Cmd', 'Healthcheck', 'ArgsEscaped', 'Volumes',
    'WorkingDir', 'Entrypoint', 'NetworkDisabled', 'MacAddress', 'OnBuild', 'StopSignal',
    'StopTimeout', 'Shell',
  ];
  const body = {};
  for (const key of configKeys) if (inspect.Config[key] !== undefined && inspect.Config[key] !== null) body[key] = inspect.Config[key];
  body.Image = image;
  body.Labels = { ...(inspect.Config.Labels || {}), 'org.opencontainers.image.revision': revision };
  body.HostConfig = inspect.HostConfig;
  return body;
}

export function sanitizedEvidence({ environment, revision, outcome, checks = {}, rollback = 'not-needed' }) {
  return {
    version: 1,
    environment,
    revision,
    outcome,
    rollback,
    checks: {
      health: Boolean(checks.health),
      ui: Boolean(checks.ui),
      unauthorizedModels: Boolean(checks.unauthorizedModels),
      configurationPreserved: Boolean(checks.configurationPreserved),
    },
  };
}

export function validatePhoneReleaseMetadata(metadata, revision) {
  if (!metadata || metadata.git_revision !== revision) throw new Error('Phone artifact revision does not match --revision.');
  if (metadata.target !== 'existing phone Linux arm64 Node 24 runtime') {
    throw new Error('Phone artifact target metadata is missing or wrong.');
  }
  return true;
}

export async function runMacSwapTransaction(operations) {
  let oldStopped = false;
  let swapped = false;
  const recover = () => {
    if (swapped) {
      try {
        operations.removeCandidate();
        operations.renameBackupToPrevious();
        operations.startPrevious();
        operations.waitForPrevious();
        operations.verifyPrevious();
        swapped = false;
        return 'restored-previous-container';
      } catch {
        return 'failed';
      }
    }
    if (oldStopped) {
      try {
        operations.startPrevious();
        operations.waitForPrevious();
        operations.verifyPrevious();
        oldStopped = false;
        return 'restarted-previous-container';
      } catch {
        return 'failed';
      }
    }
    return 'not-needed';
  };
  operations.setRecovery?.(recover);
  try {
    operations.stopPrevious();
    oldStopped = true;
    operations.renamePreviousToBackup();
    swapped = true;
    oldStopped = false;
    await operations.createCandidate();
    operations.startCandidate();
    operations.waitForCandidate();
    operations.verifyCandidate();
    operations.removeBackup();
    swapped = false;
    return 'not-needed';
  } catch (error) {
    error.rollback = recover();
    throw error;
  } finally {
    operations.setRecovery?.(() => 'not-needed');
  }
}

function assertRevision(revision) {
  if (git(['rev-parse', `${revision}^{commit}`]) !== revision) throw new Error('Revision does not resolve to the requested commit.');
  run('git', ['-C', ROOT, 'merge-base', '--is-ancestor', revision, 'origin/main'], {
    failure: 'Revision is not an ancestor of origin/main.',
  });
}

function assertExactCleanCheckout(revision) {
  if (git(['rev-parse', 'HEAD']) !== revision) throw new Error('--build requires HEAD to equal --revision.');
  if (git(['status', '--porcelain']) !== '') throw new Error('--build requires a clean checkout.');
  const expected = git(['ls-tree', 'HEAD', 'Vendor/semantic-prompt-contract']).split(/\s+/)[2];
  const actual = git(['-C', 'Vendor/semantic-prompt-contract', 'rev-parse', 'HEAD']);
  if (!expected || expected !== actual) throw new Error('Pinned semantic-contract submodule is not at the recorded gitlink.');
}

function httpStatus(url) {
  return run('curl', ['--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}', '--max-time', '10', url], {
    failure: 'Endpoint check failed.',
  });
}

function endpointChecks(baseUrl) {
  return {
    health: httpStatus(`${baseUrl}/health`) === '200',
    ui: httpStatus(`${baseUrl}/ui`) === '200',
    unauthorizedModels: httpStatus(`${baseUrl}/v1/models`) === '401',
  };
}

function dockerInspect(container) {
  return JSON.parse(run('docker', ['inspect', container], { failure: 'Docker container inspection failed.' }))[0];
}

function dockerImageRevision(image) {
  return run('docker', ['image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', image], {
    failure: 'Candidate image is missing.',
  });
}

function compareMounts(before, after) {
  const normalize = value => (value.Mounts || []).map(mount => `${mount.Type}\0${mount.Source}\0${mount.Destination}\0${mount.RW}`).sort();
  return JSON.stringify(normalize(before)) === JSON.stringify(normalize(after));
}

function dockerSocket() {
  const endpoint = run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], {
    failure: 'Docker context inspection failed.',
  });
  if (!endpoint.startsWith('unix://')) throw new Error('Only a local Unix-socket Docker context is supported.');
  return endpoint.slice('unix://'.length);
}

function dockerApi(socketPath, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const request = http.request({
      socketPath,
      method,
      path: requestPath,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {},
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) reject(new Error(`Docker API request failed with status ${response.statusCode}.`));
        else resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    request.on('error', () => reject(new Error('Docker API request failed.')));
    if (payload) request.write(payload);
    request.end();
  });
}

async function createContainerFromSnapshot(snapshot, image, revision, name) {
  const socket = dockerSocket();
  const version = JSON.parse(await dockerApi(socket, 'GET', '/version'));
  if (!/^\d+\.\d+$/.test(version.ApiVersion || '')) throw new Error('Docker API version is invalid.');
  const body = buildContainerCreateBody(snapshot, image, revision);
  await dockerApi(socket, 'POST', `/v${version.ApiVersion}/containers/create?name=${encodeURIComponent(name)}`, body);
}

function acquireLocalLock(environment) {
  const directory = path.join(os.tmpdir(), `llm-gateway-deploy-${environment}.lock`);
  try {
    run('mkdir', [directory], { failure: `Deployment lock is already held for ${environment}.` });
    writeFileSync(path.join(directory, 'pid'), `${process.pid}\n`, { mode: 0o600 });
  } catch (error) {
    throw error;
  }
  return () => rmSync(directory, { recursive: true, force: true });
}

function waitForDockerHealth(container) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = run('docker', ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}', container]);
    if (state === 'healthy' || state === 'running') return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  throw new Error('Candidate container did not become healthy.');
}

async function applyMac(options, target) {
  const releaseLock = acquireLocalLock(options.environment);
  let lockReleased = false;
  let snapshot;
  let backupName;
  let activeRecovery = () => 'not-needed';
  const releaseOnce = () => {
    if (!lockReleased) {
      releaseLock();
      lockReleased = true;
    }
  };
  const interrupted = () => {
    const rollback = activeRecovery();
    console.error(JSON.stringify(sanitizedEvidence({ environment: options.environment, revision: options.revision, outcome: 'interrupted', rollback })));
    releaseOnce();
    process.exit(130);
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  try {
    snapshot = dockerInspect(target.container);
    if (snapshot.State?.Running !== true) throw new Error('Existing container is not running.');
    const existingChecks = endpointChecks(target.baseUrl);
    if (!existingChecks.health || !existingChecks.ui || !existingChecks.unauthorizedModels) {
      throw new Error('Existing container endpoint preflight failed.');
    }
    const previousRevision = snapshot.Config.Labels?.['org.opencontainers.image.revision'] || 'unknown';
    const image = options.image || `${target.imageRepository}:git-${options.revision}`;
    if (options.build) {
      assertExactCleanCheckout(options.revision);
      try {
        const existing = dockerImageRevision(image);
        if (existing !== options.revision) throw new Error('Existing immutable image tag has a different revision.');
      } catch (error) {
        if (error.message !== 'Candidate image is missing.') throw error;
        run('docker', ['build', '--build-arg', `SOURCE_REVISION=${options.revision}`, '--tag', image, '.'], {
          inherit: true,
          failure: 'Docker image build failed.',
        });
      }
    }
    if (dockerImageRevision(image) !== options.revision) throw new Error('Candidate image revision label does not match --revision.');

    backupName = `${target.container}.rollback.${Date.now()}.${previousRevision.slice(0, 12)}`;
    let checks;
    const verifyRestored = () => {
      const restoredChecks = endpointChecks(target.baseUrl);
      if (!restoredChecks.health || !restoredChecks.ui || !restoredChecks.unauthorizedModels) throw new Error('Restored endpoint checks failed.');
    };
    await runMacSwapTransaction({
      setRecovery: recovery => { activeRecovery = recovery; },
      stopPrevious: () => run('docker', ['stop', '--time', '20', target.container], { failure: 'Existing container did not stop.' }),
      renamePreviousToBackup: () => run('docker', ['rename', target.container, backupName], { failure: 'Existing container could not be retained for rollback.' }),
      createCandidate: () => createContainerFromSnapshot(snapshot, image, options.revision, target.container),
      startCandidate: () => run('docker', ['start', target.container], { failure: 'Candidate container did not start.' }),
      waitForCandidate: () => waitForDockerHealth(target.container),
      verifyCandidate: () => {
        checks = endpointChecks(target.baseUrl);
        checks.configurationPreserved = compareMounts(snapshot, dockerInspect(target.container));
        if (!Object.values(checks).every(Boolean)) throw new Error('Candidate checks failed.');
      },
      removeBackup: () => run('docker', ['rm', backupName], { failure: 'Candidate passed, but retained rollback container cleanup failed.' }),
      removeCandidate: () => { spawnSync('docker', ['rm', '--force', target.container], { stdio: 'ignore' }); },
      renameBackupToPrevious: () => run('docker', ['rename', backupName, target.container], { failure: 'Rollback rename failed.' }),
      startPrevious: () => run('docker', ['start', target.container], { failure: 'Rollback start failed.' }),
      waitForPrevious: () => waitForDockerHealth(target.container),
      verifyPrevious: verifyRestored,
    });
    console.log(JSON.stringify(sanitizedEvidence({ environment: options.environment, revision: options.revision, outcome: 'deployed', checks })));
  } catch (error) {
    const rollback = error.rollback || activeRecovery();
    if (rollback !== 'not-needed') console.error(JSON.stringify(sanitizedEvidence({ environment: options.environment, revision: options.revision, outcome: 'failed', rollback })));
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    releaseOnce();
  }
}

function validatePrivateFile(file, label) {
  const metadata = statSync(file);
  if (!metadata.isFile()) throw new Error(`${label} must be a regular file.`);
  if ((metadata.mode & 0o022) !== 0) throw new Error(`${label} must not be group/world writable.`);
}

function readPhoneArtifact(artifact, revision) {
  validatePrivateFile(artifact, 'Phone artifact');
  const entries = run('tar', ['-tzf', artifact], { failure: 'Phone artifact cannot be listed.' }).split('\n').filter(Boolean);
  if (entries.some(entry => entry.startsWith('/') || entry.split('/').includes('..'))) throw new Error('Phone artifact contains an unsafe path.');
  for (const required of ['app/RELEASE.json', 'app/package.json', 'app/dist/index.js']) {
    if (!entries.includes(required)) throw new Error(`Phone artifact is missing ${required}.`);
  }
  const metadata = JSON.parse(run('tar', ['-xOzf', artifact, 'app/RELEASE.json'], { failure: 'Phone release metadata cannot be read.' }));
  validatePhoneReleaseMetadata(metadata, revision);
  return createHash('sha256').update(readFileSync(artifact)).digest('hex');
}

function sshOptions(options, target) {
  return [
    '-i', options.sshIdentity,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'BatchMode=yes',
    '-o', `UserKnownHostsFile=${options.knownHosts}`,
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `HostKeyAlias=${target.hostKeyAlias}`,
    '-o', 'ConnectTimeout=8',
  ];
}

function phoneReadOnlyPreflight(options, target) {
  validatePrivateFile(options.sshIdentity, 'SSH identity');
  validatePrivateFile(options.knownHosts, 'known_hosts');
  run('ssh', [...sshOptions(options, target), target.sshTarget,
    `/bin/sh -c 'test -r /opt/oneplus-llm/app/RELEASE.json && test -d /etc/oneplus-llm && rc-service ${target.service} status >/dev/null'`], {
    failure: 'Phone runtime preflight failed.',
  });
  const checks = endpointChecks(target.baseUrl);
  if (!checks.health || !checks.ui || !checks.unauthorizedModels) throw new Error('Existing phone endpoint preflight failed.');
  return checks;
}

function applyPhone(options, target) {
  const releaseLock = acquireLocalLock(options.environment);
  let ssh;
  let remoteDirectory;
  try {
    const digest = readPhoneArtifact(options.artifact, options.revision);
    phoneReadOnlyPreflight(options, target);
    remoteDirectory = `/home/server/.cache/llm-gateway-deploy/${options.revision}`;
    const remoteArtifact = `${remoteDirectory}/release.tar.gz`;
    const remoteInstaller = `${remoteDirectory}/install.sh`;
    ssh = sshOptions(options, target);
    run('ssh', [...ssh, target.sshTarget, `/bin/sh -c 'umask 077; mkdir -p ${remoteDirectory}'`], {
      failure: 'Phone staging directory could not be created.',
    });
    run('scp', [...ssh, options.artifact, `${target.sshTarget}:${remoteArtifact}`], { failure: 'Phone artifact upload failed.' });
    run('scp', [...ssh, path.join(ROOT, 'scripts/deploy/phone-install.sh'), `${target.sshTarget}:${remoteInstaller}`], {
      failure: 'Phone installer upload failed.',
    });
    const result = spawnSync('ssh', [
      '-tt', ...ssh, target.sshTarget,
      `sudo -k -- /bin/sh ${remoteInstaller} ${options.revision} ${digest} ${remoteArtifact} ${target.baseUrl}`,
    ], { cwd: ROOT, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error('Phone deployment failed; the remote installer attempted rollback.');
    console.log(JSON.stringify(sanitizedEvidence({
      environment: options.environment,
      revision: options.revision,
      outcome: 'deployed',
      checks: { health: true, ui: true, unauthorizedModels: true, configurationPreserved: true },
    })));
  } finally {
    if (ssh && remoteDirectory) {
      spawnSync('ssh', [...ssh, target.sshTarget, `/bin/sh -c 'rm -rf ${remoteDirectory}'`], { stdio: 'ignore' });
    }
    releaseLock();
  }
}

function plan(options, target) {
  if (target.kind === 'docker') {
    const inspect = dockerInspect(target.container);
    const checks = endpointChecks(target.baseUrl);
    console.log(JSON.stringify({
      mode: 'plan',
      environment: options.environment,
      revision: options.revision,
      targetKind: target.kind,
      currentRevision: inspect.Config.Labels?.['org.opencontainers.image.revision'] || 'unknown',
      preservedMountCount: inspect.Mounts?.length || 0,
      checks: { health: checks.health, ui: checks.ui, unauthorizedModels: checks.unauthorizedModels },
      applyConfirmation: `${options.environment}:${options.revision}`,
    }));
  } else {
    let checks = { health: false, ui: false, unauthorizedModels: false };
    if (options.sshIdentity && options.knownHosts) checks = phoneReadOnlyPreflight(options, target);
    if (options.artifact) readPhoneArtifact(options.artifact, options.revision);
    console.log(JSON.stringify({
      mode: 'plan',
      environment: options.environment,
      revision: options.revision,
      targetKind: target.kind,
      artifactValidated: Boolean(options.artifact),
      pinnedSshPreflight: Boolean(options.sshIdentity && options.knownHosts),
      checks,
      applyConfirmation: `${options.environment}:${options.revision}`,
    }));
  }
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return 0;
    }
    assertRevision(options.revision);
    const target = TARGETS[options.environment];
    if (!options.apply) plan(options, target);
    else if (target.kind === 'docker') await applyMac(options, target);
    else applyPhone(options, target);
    return 0;
  } catch (error) {
    console.error(`Deployment stopped safely: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
