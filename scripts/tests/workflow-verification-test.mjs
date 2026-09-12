import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyPaths, impactBetween } from '../verification-impact.mjs';
import { validateProfile, parseProfile, readSecureProfile, validateLiveProof, probeContract, targetDigest } from '../live-proof-lib.mjs';
import { validateWorkflowEvidence } from '../validate-workflow-evidence.mjs';
// Hooks export Git context; synthetic repositories must never inherit the caller's index/config.
for (const name of Object.keys(process.env)) if (name.startsWith('GIT_')) delete process.env[name];
const head = 'a'.repeat(40);
const profile = { version: 1, provider: 'ollama', upstreamUrl: 'http://127.0.0.1:11434', model: 'fixture:model', timeoutMs: 1000 };
const proof = () => ({ version: 1, head, provider: 'ollama', targetDigest: targetDigest(profile), testedAt: new Date().toISOString(), assertions: { authentication: true, models: true, completion: true, streaming: true } });
const body = () => `- Workflow live proof: ${JSON.stringify(proof())}\n- Workflow browser proof: observed:${head}:local-reviewed-artifact`;

test('impact routes runtime and browser changes, including deleted/renamed files', () => {
  assert.deepEqual(classifyPaths(['README.md', '.agents/skills/audit-gateway-ui/SKILL.md']), { live: false, browser: false });
  for (const path of ['src/proxy/ollama.ts', 'src/new-runtime.ts', 'package-lock.json', 'Dockerfile', 'Vendor/semantic-prompt-contract', 'scripts/live-proof-lib.mjs', 'scripts/check-live.mjs']) assert.equal(classifyPaths([path]).live, true);
  assert.deepEqual(classifyPaths(['public/admin/index.html']), { live: false, browser: true });
  assert.deepEqual(classifyPaths(['src/server.ts']), { live: true, browser: true });
  const dir = mkdtempSync(join(tmpdir(), 'impact-policy-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    mkdirSync(join(dir, 'src')); writeFileSync(join(dir, 'src/server.ts'), 'fixture\n'); git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture');
    const base = git('rev-parse', 'HEAD'); git('mv', 'src/server.ts', 'archived.txt'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-am', 'fixture rename');
    assert.deepEqual(impactBetween(dir, base, 'HEAD'), { live: true, browser: true });
    assert.throws(() => impactBetween(dir, 'missing-ref', 'HEAD'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('profiles reject unknown fields, unsafe targets and provider/model substitution', () => {
  assert.equal(validateProfile(profile).upstreamUrl, profile.upstreamUrl);
  assert.throws(() => parseProfile(JSON.stringify(profile).replace('{', '{\"model\":\"other:model\",')));
  assert.deepEqual(parseProfile(JSON.stringify(profile)), profile);
  for (const patch of [{ provider: 'other' }, { model: '../bad model' }, { model: 'apple-foundationmodel' }, { provider: 'apfel' }, { timeoutMs: 0 }, { timeoutMs: 999999 }, { fallback: true }, { upstreamUrl: 'http://remote.example' }, { upstreamUrl: 'https://name:password@example.invalid' }, { upstreamUrl: 'https://example.invalid/private' }, { upstreamUrl: 'https://example.invalid/?token=x' }]) assert.throws(() => validateProfile({ ...profile, ...patch }));
  assert.equal(validateProfile({ ...profile, provider: 'apfel', model: 'apple-foundationmodel' }).provider, 'apfel');
});
test('local profiles require ignored untracked owned private files without symlinks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seed-policy-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  try {
    git('init'); writeFileSync(join(dir, '.gitignore'), '.agent/\n');
    mkdirSync(join(dir, '.agent/local-seeds'), { recursive: true, mode: 0o700 });
    const file = join(dir, '.agent/local-seeds/gateway-live.json');
    writeFileSync(file, JSON.stringify(profile), { mode: 0o600 });
    assert.deepEqual(readSecureProfile(dir), profile);
    chmodSync(file, 0o644); assert.throws(() => readSecureProfile(dir)); chmodSync(file, 0o600);
    git('add', '-f', '.agent/local-seeds/gateway-live.json'); assert.throws(() => readSecureProfile(dir)); git('rm', '--cached', '.agent/local-seeds/gateway-live.json');
    rmSync(file); const other = join(dir, 'other'); writeFileSync(other, JSON.stringify(profile), { mode: 0o600 }); symlinkSync(other, file);
    assert.throws(() => readSecureProfile(dir));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('evidence rejects stale heads, wrong target, missing assertions, extra fields and missing browser proof', () => {
  validateLiveProof(proof(), head, targetDigest(profile));
  for (const patch of [{ head: 'b'.repeat(40) }, { targetDigest: 'wrong' }, { assertions: { completion: true } }, { rawResponse: 'forbidden' }, { testedAt: 'unknown' }]) assert.throws(() => validateLiveProof({ ...proof(), ...patch }, head));
  assert.throws(() => validateLiveProof(proof(), head, 'b'.repeat(64)));
  assert.equal(validateWorkflowEvidence({ body: body(), head, impact: { live: true, browser: true } }), true);
  for (const changed of [body().replace(/\{.*\}/u, 'not-required'), body().replace(`observed:${head}`, `observed:${'b'.repeat(40)}`), body().replace(`observed:${head}:local-reviewed-artifact`, 'not-required'), body() + '\n- Workflow live proof: not-required', body().replace('observed:', 'human-approved:')]) assert.throws(() => validateWorkflowEvidence({ body: changed, head, impact: { live: true, browser: true } }));
  assert.equal(validateWorkflowEvidence({ body: '- Workflow live proof: not-required\n- Workflow browser proof: not-required', head, impact: { live: false, browser: false } }), true);
});
test('contract probe rejects wrong model, empty completion, malformed SSE and failed authentication', async () => {
  const original = globalThis.fetch;
  let mode = 'ok';
  globalThis.fetch = async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url === profile.upstreamUrl + '/api/tags') return Response.json({ models: mode === 'missing-provider-model' ? [] : [{ name: profile.model }] });
    if (!options.headers.Authorization) return new Response(null, { status: mode === 'auth' ? 200 : 401 });
    if (url.endsWith('/models')) return Response.json({ data: [{ id: profile.model }] });
    const model = mode === 'wrong-model' ? 'substitute:model' : profile.model;
    if (!JSON.parse(options.body).stream) return Response.json({ object: 'chat.completion', model, choices: [{ message: { role: 'assistant', content: mode === 'empty' ? '' : 'Fixture' } }] });
    const chunk = JSON.stringify({ object: 'chat.completion.chunk', model, choices: [{ delta: { content: 'Fixture' }, finish_reason: 'stop' }] });
    return new Response(`data: ${chunk}\n\n${mode === 'bad-stream' ? '' : 'data: [DONE]\n\n'}`, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const options = { url: 'http://127.0.0.1', clientKey: 'fixture', profile };
    assert.deepEqual(await probeContract(options), proof().assertions);
    for (mode of ['auth', 'wrong-model', 'empty', 'bad-stream', 'missing-provider-model']) await assert.rejects(probeContract(options));
  } finally { globalThis.fetch = original; }
});
