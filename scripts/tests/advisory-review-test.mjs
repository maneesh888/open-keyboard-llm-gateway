import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdvisory } from '../advisory-review.mjs';
const expected = { base: 'a'.repeat(40), head: 'b'.repeat(40) };
const record = () => ({ version: 1, ...expected, route: 'local-security', status: 'completed', scope: 'PR diff and supporting authorization code', reason: 'Authorization boundary changed', inspected: true, privateReport: 'private scan reference', findings: [] });
test('completed record binds inspected report and dispositions to exact revisions', () => {
  assert.deepEqual(validateAdvisory(record(), expected), { status: 'completed', unresolved: 0 });
  assert.equal(validateAdvisory({ ...record(), findings: [{ id: 'F1', disposition: 'unresolved', evidence: 'Private reproduction reference' }] }, expected).unresolved, 1);
});
test('failed, pending and unavailable are valid statuses but never clean reviews', () => {
  for (const status of ['pending', 'failed', 'unavailable', 'not-applicable']) {
    const r = { ...record(), status, inspected: false, privateReport: null };
    assert.equal(validateAdvisory(r, expected).status, status);
    assert.throws(() => validateAdvisory({ ...r, inspected: true }, expected));
    assert.throws(() => validateAdvisory({ ...r, findings: [{ id: 'F1' }] }, expected));
  }
});
test('stale revisions, invented statuses, missing inspection and unsupported dispositions fail', () => {
  for (const patch of [{ head: 'c'.repeat(40) }, { base: 'c'.repeat(40) }, { status: 'clean' }, { inspected: false }, { privateReport: '' }, { reason: '' }, { route: 'project-reviewer' }, { findings: [{ id: 'F1', disposition: 'waived', evidence: 'none' }] }]) assert.throws(() => validateAdvisory({ ...record(), ...patch }, expected));
  const finding = { id: 'F1', disposition: 'fixed', evidence: 'Regression reference' };
  assert.throws(() => validateAdvisory({ ...record(), findings: [finding, finding] }, expected));
  for (const placeholder of ['pending', 'none', 'unknown']) {
    assert.throws(() => validateAdvisory({ ...record(), privateReport: placeholder }, expected));
    assert.throws(() => validateAdvisory({ ...record(), findings: [{ ...finding, evidence: placeholder }] }, expected));
  }
});
