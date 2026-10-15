import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { classifyRaw, scope } from '../verification-scope.mjs';
import { validateResults } from '../validate-check-results.mjs';
for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
const oid = 'a'.repeat(40);
const raw = (path, before = '100644', after = '100644', status = 'M') => `:${before} ${after} ${before === '000000' ? '0'.repeat(40) : oid} ${after === '000000' ? '0'.repeat(40) : oid} ${status}\0${path}\0`;
test('only ordinary prose with regular modes can select docs', () => {
  for (const path of ['docs/notes.md', 'docs/guide/example.md']) {
    assert.equal(classifyRaw(raw(path)), 'docs');
    assert.equal(classifyRaw(raw(path, '000000', '100644', 'A')), 'docs');
    assert.equal(classifyRaw(raw(path, '100644', '000000', 'D')), 'docs');
  }
  for (const path of ['README.md', 'AGENTS.md', 'src/server.ts', 'package-lock.json', '.github/workflows/ci.yml', '.agents/skills/x/SKILL.md', 'scripts/example.md', 'docs/SECURITY.md', 'docs/nested/WORKFLOW.md', 'docs/setup/example.md', 'docs/OPENAI_COMPATIBILITY.md', 'docs/OPEN_KEYBOARD_CLIENT.md', 'docs/PR_REVIEW_EVIDENCE_ACTIVATION.md', 'docs/requirements.md', 'config.json', 'unknown', 'docs/bad\nname.md']) {
    assert.equal(classifyRaw(raw('docs/notes.md') + raw(path)), 'full', path);
  }
  for (const mode of ['100755', '120000', '160000']) assert.equal(classifyRaw(raw('docs/notes.md', '100644', mode)), 'full');
  for (const invalid of ['', 'unknown', raw('docs/notes.md').slice(0, -1), raw('docs/notes.md').replace(' M\0', ' R100\0'), raw('docs/notes.md').replace(oid, 'unknown')]) assert.equal(classifyRaw(invalid), 'full');
});
test('real Git ranges bind staged/committed paths, renames, modes and trusted policy', () => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-scope-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, content) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };
  const commit = () => { git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  const selector = resolve('scripts/select-verification-scope.sh');
  const select = (...args) => execFileSync('bash', [selector, ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    write('docs/notes.md', 'First\n'); write('src/server.ts', 'fixture\n');
    const oldBase = commit();
    write('scripts/verification-scope.mjs', readFileSync(new URL('../verification-scope.mjs', import.meta.url), 'utf8'));
    const base = commit();
    write('docs/notes.md', 'Second\n'); git('add', 'docs/notes.md');
    assert.equal(scope(root, ['--staged']), 'docs');
    assert.equal(select('--staged'), 'docs');
    const head = commit();
    assert.equal(scope(root, ['--range', base, head]), 'docs');
    assert.equal(select('--range', oldBase, head), 'full'); // Missing trusted classifier cannot reduce.
    assert.equal(select('--range', base, head), 'docs');
    assert.throws(() => select('--range', 'missing', head));
    assert.throws(() => scope(root, ['--range', '--help', head]));
    write('scripts/verification-scope.mjs', 'console.log("docs")\n'); commit();
    assert.equal(select('--range', base, 'HEAD'), 'full'); // Candidate cannot select its own result.
    git('reset', '--hard', head);
    git('mv', 'src/server.ts', 'docs/moved.md'); commit();
    assert.equal(select('--range', base, 'HEAD'), 'full');
    git('reset', '--hard', head); chmodSync(join(root, 'docs/notes.md'), 0o755); commit();
    assert.equal(select('--range', base, 'HEAD'), 'full');
    git('reset', '--hard', head); write('docs/notes.md', 'Trailing whitespace  \n'); commit();
    assert.throws(() => git('diff', '--check', `${base}...HEAD`));
    git('reset', '--hard', head); write('scripts/verification-scope.mjs', 'console.log("unknown")\n'); const invalidBase = commit();
    assert.throws(() => select('--range', invalidBase, invalidBase));
    write('scripts/verification-scope.mjs', 'process.exit(1)\n'); const failedBase = commit();
    assert.throws(() => select('--range', failedBase, failedBase));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('aggregate allows deliberate docs skips only after successful classification and hygiene', () => {
  const results = { scope: 'success', hygiene: 'success', tests: 'success', build: 'success', docker: 'success', browser: 'success', semantic: 'success' };
  assert.equal(validateResults('full', results), true);
  const docs = { ...results, ...Object.fromEntries(['tests', 'build', 'docker', 'browser', 'semantic'].map(k => [k, 'skipped'])) };
  assert.equal(validateResults('docs', docs), true);
  for (const bad of ['', 'unknown', undefined]) assert.throws(() => validateResults(bad, docs));
  for (const name of Object.keys(results)) for (const result of ['failure', 'cancelled', '', undefined]) assert.throws(() => validateResults('full', { ...results, [name]: result }));
  assert.throws(() => validateResults('full', docs));
  assert.throws(() => validateResults('docs', { ...docs, scope: 'skipped' }));
  assert.throws(() => validateResults('docs', { ...docs, hygiene: 'failure' }));
});

test('metadata preparation requires trusted markers and every trusted validator without candidate fallback', () => {
  const workflow = resolve('.github/workflows/pr-review-evidence.yml');
  const script = execFileSync('ruby', ['-ryaml', '-e', 'w=YAML.load_file(ARGV[0]); print w["jobs"]["required-review-evidence"]["steps"].find { |s| s["id"] == "validators" }["run"]', workflow], { encoding: 'utf8' });
  const root = mkdtempSync(join(tmpdir(), 'gateway-metadata-trust-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (path, content) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };
  const commit = () => { git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
  const run = base => execFileSync('bash', ['-euo', 'pipefail', '-c', script], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PR_BASE_SHA: base, RUNNER_TEMP: join(root, 'runner'), GITHUB_OUTPUT: join(root, 'output') } });
  try {
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    write('README.md', 'Fixture\n'); const absent = commit();
    write('.github/review-evidence-enforced', 'enforced\n'); const markerOnly = commit();
    const names = ['pr-evidence-lib.mjs', 'validate-pr-requirements.mjs', 'validate-pr-review-record.mjs', 'validate-pr-review-evidence-event.mjs', 'verification-impact.mjs', 'live-proof-lib.mjs', 'validate-workflow-evidence.mjs'];
    for (const name of names) write(`scripts/${name}`, 'trusted fixture\n');
    const missingWorkflowMarker = commit();
    write('.github/verification-evidence-enforced', 'enforced\n'); const trusted = commit();
    for (const name of names) write(`scripts/${name}`, 'candidate must not be copied\n');
    for (const base of [absent, markerOnly, missingWorkflowMarker]) assert.throws(() => run(base));
    run(trusted);
    for (const name of names) assert.equal(readFileSync(join(root, 'runner/pr-evidence-validators', name), 'utf8'), 'trusted fixture\n');
    assert.match(readFileSync(join(root, 'output'), 'utf8'), /source=trusted-base/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
