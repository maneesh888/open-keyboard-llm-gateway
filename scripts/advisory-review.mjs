#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A private bookkeeping validator, never a branch-protection gate or a scan runner.
export function validateAdvisory(record, expected) {
  const sha = /^[0-9a-f]{40}$/u;
  if (!record || record.version !== 1 || !sha.test(expected.base) || !sha.test(expected.head)
      || record.base !== expected.base || record.head !== expected.head) throw new Error('Review revisions are missing or stale.');
  const text = value => typeof value === 'string' && value.trim().length > 0
    && !/^(pending|unknown|none|unavailable|not[- ]applicable)$/iu.test(value.trim());
  if (!['app-code-review', 'github-code-review', 'local-security', 'github-security', 'security-cloud'].includes(record.route)
      || !['pending', 'completed', 'failed', 'unavailable', 'not-applicable'].includes(record.status)
      || !text(record.scope) || !text(record.reason) || !Array.isArray(record.findings)) throw new Error('Invalid advisory record.');
  if (record.status === 'completed' && (record.inspected !== true || !text(record.privateReport))) throw new Error('Completion requires an inspected private report.');
  if (record.status !== 'completed' && (record.inspected !== false || record.findings.length !== 0)) throw new Error('Incomplete reviews cannot claim inspected findings.');
  const ids = new Set();
  for (const finding of record.findings) {
    if (!text(finding.id) || ids.has(finding.id) || !['accepted', 'dismissed', 'fixed', 'unresolved'].includes(finding.disposition)
        || !text(finding.evidence)) throw new Error('Every finding needs a unique ID and an evidenced disposition.');
    ids.add(finding.id);
  }
  return { status: record.status, unresolved: record.findings.filter(f => ['accepted', 'unresolved'].includes(f.disposition)).length };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5) throw new Error('Expected private record, base and head.');
    const result = validateAdvisory(JSON.parse(readFileSync(process.argv[2], 'utf8')), { base: process.argv[3], head: process.argv[4] });
    console.log(`Advisory record valid: status=${result.status}, unresolved=${result.unresolved}. This does not establish scan quality or merge readiness.`);
  } catch { console.error('Advisory review record is invalid, incomplete, or stale.'); process.exitCode = 1; }
}
