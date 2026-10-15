#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateResults(scope, results) {
  if (!['docs', 'full'].includes(scope) || results.scope !== 'success' || results.hygiene !== 'success') throw new Error('Scope and hygiene must succeed.');
  for (const name of ['tests', 'build', 'docker', 'browser', 'semantic']) {
    if (results[name] !== (scope === 'docs' ? 'skipped' : 'success')) throw new Error(`Unexpected ${name} result for ${scope}.`);
  }
  return true;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    validateResults(process.env.VERIFICATION_SCOPE, Object.fromEntries(
      ['scope', 'hygiene', 'tests', 'build', 'docker', 'browser', 'semantic'].map(name => [name, process.env[`${name.toUpperCase()}_RESULT`]])
    ));
    console.log('All selected LLM Gateway checks passed.');
  } catch { console.error('Required checks did not pass for the exact verification scope.'); process.exitCode = 1; }
}
