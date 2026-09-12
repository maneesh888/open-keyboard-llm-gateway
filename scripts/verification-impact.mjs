#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Use complete paths and both sides of renames. Unknown runtime surfaces fail closed.
export function classifyPaths(paths) {
  if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || !path || path.includes('\0'))) throw new Error('Invalid changed-path input.');
  const live = paths.some(path => /^(src\/|Vendor\/semantic-prompt-contract(?:\/|$)|package(?:-lock)?\.json$|Dockerfile$|docker-compose[^/]*\.ya?ml$|\.gitmodules$|scripts\/(?:check-live\.(?:sh|mjs)|live-proof-lib\.mjs|verification-impact\.mjs|lib\/gateway-test-server\.mjs)$)/u.test(path));
  const browser = paths.some(path => /^(public\/|src\/(?:(?:admin|models)\/|server\.ts$)|Vendor\/semantic-prompt-contract(?:\/|$))/u.test(path));
  return { live, browser };
}
export function impactBetween(root, base, head) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const revision of [base, head]) {
    if (!revision || revision.startsWith('-')) throw new Error('A valid comparison base and head are required.');
    git('rev-parse', '--verify', `${revision}^{commit}`);
  }
  git('merge-base', base, head);
  const paths = git('diff', '--no-renames', '--name-only', '-z', `${base}...${head}`).split('\0').filter(Boolean);
  return classifyPaths(paths);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: verification-impact.mjs <base> <head>');
    console.log(JSON.stringify(impactBetween(process.cwd(), process.argv[2], process.argv[3])));
  } catch { console.error('Verification impact could not resolve a valid base/head comparison.'); process.exitCode = 1; }
}
