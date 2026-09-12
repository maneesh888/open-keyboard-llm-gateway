import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { createHash } from 'node:crypto';

export function validateProfile(value) {
  const fields = ['version', 'provider', 'upstreamUrl', 'model', 'timeoutMs'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !fields.includes(key)) || fields.some(key => !(key in value))) throw new Error('Live profile must contain only the documented fields.');
  if (value.version !== 1 || !['ollama', 'apfel'].includes(value.provider)
    || typeof value.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/u.test(value.model)
    || !Number.isInteger(value.timeoutMs) || value.timeoutMs < 1000 || value.timeoutMs > 180000) throw new Error('Invalid live profile version, provider, model or timeout.');
  if ((value.provider === 'apfel') !== (value.model === 'apple-foundationmodel')) throw new Error('Live provider and exact model route do not match.');
  let url; try { url = new URL(value.upstreamUrl); } catch { throw new Error('Live upstream must be an explicit origin.'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !['http:', 'https:'].includes(url.protocol)
    || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Live upstream requires HTTPS or loopback HTTP, with no credentials, path or query.');
  return { ...value, upstreamUrl: url.origin };
}
export function parseProfile(text) {
  const value = JSON.parse(text);
  const keys = [...text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/gu)].map(match => JSON.parse('"' + match[1] + '"'));
  if (new Set(keys).size !== keys.length || keys.length !== 5) throw new Error('Duplicate or nested live profile fields are not allowed.');
  return validateProfile(value);
}
export function targetDigest(profile) {
  return createHash('sha256').update(JSON.stringify([profile.provider, profile.upstreamUrl, profile.model])).digest('hex');
}
export function readSecureProfile(root) {
  const common = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim();
  const primary = dirname(common);
  const directory = join(primary, '.agent', 'local-seeds');
  const file = join(directory, 'gateway-live.json');
  for (const path of [join(primary, '.agent'), directory, file]) {
    const info = lstatSync(path);
    if (info.isSymbolicLink() || info.uid !== process.getuid() || (path === file ? !info.isFile() || info.nlink !== 1 : !info.isDirectory())) throw new Error('Live profile path ownership or type is unsafe.');
    if (path !== join(primary, '.agent') && (info.mode & 0o077) !== 0) throw new Error('Live seed directory/file must deny group and other access.');
    if (process.platform === 'darwin') {
      const permissions = execFileSync('/bin/ls', ['-lde', path], { encoding: 'utf8' }).split(/\s/u)[0];
      if (permissions.includes('+')) throw new Error('Live profile paths must not have extended ACLs.');
    }
  }
  if (realpathSync(file) !== file) throw new Error('Live profile path must not traverse symbolic links.');
  execFileSync('git', ['-C', primary, 'check-ignore', '--quiet', relative(primary, file)], { stdio: 'ignore' });
  const tracked = execFileSync('git', ['-C', primary, 'ls-files', '--', relative(primary, file)], { encoding: 'utf8' });
  if (tracked.trim()) throw new Error('Live profile must remain untracked.');
  try { return parseProfile(readFileSync(file, 'utf8')); } catch { throw new Error('Live profile is missing or invalid; use the documented local seed template.'); }
}
async function boundedText(response) {
  if (!response.body) throw new Error('Live response body is absent.');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 524288) throw new Error('Live response exceeds the evidence probe limit.');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); }
}
export async function probeContract({ url, clientKey, profile }) {
  const request = (path, options = {}, authenticated = true) => fetch(`${url}${path}`, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(profile.timeoutMs),
    headers: { ...(authenticated ? { Authorization: `Bearer ${clientKey}` } : {}), 'Content-Type': 'application/json' },
  });
  const denied = await request('/v1/models', {}, false);
  await denied.body?.cancel(); if (denied.status !== 401) throw new Error('Live authentication boundary failed.');
  const models = await request('/v1/models');
  if (!models.ok) { await models.body?.cancel(); throw new Error('Live model listing failed.'); }
  const catalog = JSON.parse(await boundedText(models));
  if (!catalog.data?.some(item => item.id === profile.model)) throw new Error('Exact required live model is absent.');
  const providerModels = await fetch(profile.upstreamUrl + (profile.provider === 'ollama' ? '/api/tags' : '/v1/models'), { redirect: 'error', signal: AbortSignal.timeout(profile.timeoutMs) });
  if (!providerModels.ok) { await providerModels.body?.cancel(); throw new Error('Required provider catalog is unavailable.'); }
  const providerCatalog = JSON.parse(await boundedText(providerModels));
  const available = profile.provider === 'ollama'
    ? providerCatalog.models?.some(item => (item.name || item.model) === profile.model)
    : providerCatalog.data?.some(item => item.id === profile.model);
  if (!available) throw new Error('Exact model is absent from the required provider catalog.');
  // Public transport fixture only: this is not a semantic operation or model-quality evaluation.
  const messages = [{ role: 'user', content: 'Reply with a brief greeting.' }];
  for (const stream of [false, true]) {
    const response = await request('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: profile.model, messages, stream, max_tokens: 32 }) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Live completion request failed.'); }
    const raw = await boundedText(response);
    if (!stream) {
      const value = JSON.parse(raw);
      if (value.model !== profile.model || value.object !== 'chat.completion'
        || !value.choices?.some(choice => choice.message?.role === 'assistant' && typeof choice.message.content === 'string' && choice.message.content.trim())) throw new Error('Live completion identity or contract failed.');
    } else {
      if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Live streaming media type failed.');
      const events = raw.split(/\r?\n\r?\n/u).filter(Boolean).map(event => event.split(/\r?\n/u).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')).filter(Boolean);
      if (events.at(-1) !== '[DONE]') throw new Error('Live stream did not terminate correctly.');
      let content = false; let finished = false;
      for (const event of events.slice(0, -1)) {
        const value = JSON.parse(event);
        if (value.model !== profile.model || value.object !== 'chat.completion.chunk' || !Array.isArray(value.choices)) throw new Error('Live stream identity or contract failed.');
        content ||= value.choices.some(choice => typeof choice.delta?.content === 'string' && choice.delta.content.trim());
        finished ||= value.choices.some(choice => typeof choice.finish_reason === 'string');
      }
      if (!content || !finished) throw new Error('Live stream lacks content or completion.');
    }
  }
  return { authentication: true, models: true, completion: true, streaming: true };
}
export function validateLiveProof(proof, head, expectedDigest) {
  if (!proof || Object.keys(proof).sort().join(',') !== 'assertions,head,provider,targetDigest,testedAt,version'
    || proof.version !== 1 || !/^[0-9a-f]{40}$/u.test(head) || proof.head !== head
    || !['ollama', 'apfel'].includes(proof.provider) || !/^[0-9a-f]{64}$/u.test(proof.targetDigest)
    || (expectedDigest && proof.targetDigest !== expectedDigest)
    || !Number.isFinite(Date.parse(proof.testedAt)) || Date.parse(proof.testedAt) > Date.now() + 300000
    || !proof.assertions || Object.keys(proof.assertions).sort().join(',') !== 'authentication,completion,models,streaming'
    || Object.values(proof.assertions).some(value => value !== true)) throw new Error('Missing, stale, substituted, or incomplete exact-head live evidence.');
  return proof;
}
