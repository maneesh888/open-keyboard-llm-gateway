#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readSecureProfile, targetDigest, probeContract, validateLiveProof } from './live-proof-lib.mjs';
import { startLiveGateway } from './lib/gateway-test-server.mjs';
const root = resolve('.');
const output = join(root, '.ci-results/live-proof.json');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let gateway;
try {
  rmSync(output, { force: true });
  const head = git('rev-parse', 'HEAD');
  const requireHead = () => { if (git('rev-parse', 'HEAD') !== head || git('status', '--porcelain=v1', '--untracked-files=all')) throw new Error('Live proof requires a clean unchanged committed head.'); };
  requireHead();
  const profile = readSecureProfile(root);
  execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' });
  requireHead();
  gateway = await startLiveGateway({ root, profile });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void gateway.close().finally(() => process.exit(1)); });
  const assertions = await probeContract({ ...gateway, profile });
  requireHead();
  const proof = { version: 1, head, provider: profile.provider, targetDigest: targetDigest(profile), testedAt: new Date().toISOString(), assertions };
  validateLiveProof(proof, head, targetDigest(profile));
  mkdirSync(join(root, '.ci-results'), { recursive: true });
  writeFileSync(output, JSON.stringify(proof) + '\n', { mode: 0o600 });
  console.log(`LIVE_VERIFIED ${head}; sanitized evidence: .ci-results/live-proof.json`);
  console.log('Proof covers the configured target transport/contract only; no semantic-quality or UI acceptance claim.');
} catch {
  console.error('LIVE_UNVERIFIED: exact-head/profile validation or live contract checks failed. No fallback or retained response body.');
  process.exitCode = 1;
} finally { await gateway?.close(); }
