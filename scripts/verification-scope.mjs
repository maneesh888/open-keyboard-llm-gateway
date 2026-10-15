#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Ordinary prose only. Setup, contracts, acceptance criteria and policy remain Full.
const protectedName = /agent|readme|policy|workflow|verification|review|evidence|activation|release|testing|security|privacy|test[_-]?plan|smoke|setup|requirements|contract|compatibility|client|audit|apfel/iu;
export function documentationPath(path) {
  return /^docs\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.md$/u.test(path)
    && !path.split('/').slice(1).some(part => protectedName.test(part));
}

export function classifyRaw(raw) {
  const records = raw.split('\0');
  if (records.pop() !== '' || !records.length || records.length % 2) return 'full';
  for (let i = 0; i < records.length; i += 2) {
    const match = /^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([AMD])$/u.exec(records[i]);
    if (!match || !documentationPath(records[i + 1])) return 'full';
    const [, before, after, oldOid, newOid, status] = match;
    const zero = '0'.repeat(40);
    const valid = status === 'A' ? before === '000000' && after === '100644' && oldOid === zero && newOid !== zero
      : status === 'D' ? before === '100644' && after === '000000' && oldOid !== zero && newOid === zero
        : before === '100644' && after === '100644' && oldOid !== zero && newOid !== zero;
    if (!valid) return 'full';
  }
  return 'docs';
}

export function scope(root, args) {
  const git = (...argv) => execFileSync('git', ['-C', root, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const diff = ['diff', '--raw', '--no-abbrev', '--no-renames', '-z'];
  if (args.length === 1 && args[0] === '--staged') return classifyRaw(git(...diff, '--cached', 'HEAD', '--'));
  if (args.length !== 3 || args[0] !== '--range') throw new Error('Expected --staged or --range BASE HEAD.');
  const revisions = args.slice(1).map(ref => {
    if (!ref || ref.startsWith('-')) throw new Error('Invalid revision.');
    return git('rev-parse', '--verify', `${ref}^{commit}`).trim();
  });
  const base = git('merge-base', ...revisions).trim();
  return classifyRaw(git(...diff, base, revisions[1], '--'));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(scope(process.cwd(), process.argv.slice(2))); }
  catch { console.error('Verification scope cannot inspect the exact Git diff.'); process.exitCode = 1; }
}
