#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative, resolve, sep } from 'node:path';
import process from 'node:process';

const repositoryRoot = resolve(
  process.env.LLM_GATEWAY_REPOSITORY_ROOT || fileURLToPath(new URL('..', import.meta.url)),
);

const privatePathPatterns = [
  /^\.env(?:\..+)?$/,
  /(?:^|\/)\.env(?:\..+)?$/,
  /^config\/(?:admin|config|keys)\.json$/,
  /(?:^|\/)\.agent\/local-seeds\//,
];

const allowedFakeValues = new Set([
  'sk-allora-change-me',
  'sk-openclaw-change-me',
  'sk-existing-secret-value',
]);
const allowedExampleSecrets = new Set([
  'REPLACE_WITH_LONG_RANDOM_SECRET_32_BYTES_MINIMUM',
]);

const secretPatterns = [
  { name: 'API key', expression: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'GitHub token', expression: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: 'JWT', expression: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: 'Bearer token', expression: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g },
  { name: 'private key', expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  {
    name: 'provider environment secret',
    expression: /\b(?:OPENAI_API_KEY|OPENROUTER_API_KEY|ANTHROPIC_API_KEY)\s*[:=]\s*["']?[^\s"']{12,}/g,
  },
  { name: 'hard-coded JWT secret', expression: /\bjwtSecret\s*[:=]\s*["'`][^"'`]{16,}["'`]/g },
];

function git(args) {
  return execFileSync('git', ['-C', repositoryRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function repositoryFiles() {
  return git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean);
}

function trackedFiles() {
  return new Set(git(['ls-files', '-z']).split('\0').filter(Boolean));
}

function isExample(path) {
  return path.endsWith('.example') || path.includes('.example.');
}

function normalizedRelativePath(path) {
  return relative(repositoryRoot, resolve(repositoryRoot, path)).split(sep).join('/');
}

let files;
let tracked;
try {
  git(['rev-parse', '--is-inside-work-tree']);
  files = repositoryFiles();
  tracked = trackedFiles();
} catch (error) {
  console.error('Secret scan failed: repository files could not be enumerated.');
  process.exit(error.status || 2);
}

const findings = [];

for (const file of files) {
  const relativePath = normalizedRelativePath(file);
  if (tracked.has(file) && !isExample(relativePath) && privatePathPatterns.some(pattern => pattern.test(relativePath))) {
    findings.push({ path: relativePath, line: 1, kind: 'tracked private configuration' });
    continue;
  }

  let content;
  try {
    content = readFileSync(resolve(repositoryRoot, file), 'utf8');
  } catch {
    continue;
  }
  if (content.includes('\0')) continue;

  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { name, expression } of secretPatterns) {
      expression.lastIndex = 0;
      let match;
      while ((match = expression.exec(line)) !== null) {
        const matchedValue = match[0];
        if (allowedFakeValues.has(matchedValue)) continue;
        if (isExample(relativePath) && [...allowedExampleSecrets].some(value => matchedValue.includes(value))) continue;
        if (name === 'hard-coded JWT secret' && /["'`]test-[^"'`]+["'`]$/.test(matchedValue)) continue;
        findings.push({ path: relativePath, line: index + 1, kind: name });
      }
    }
  });
}

if (findings.length > 0) {
  console.error('Secret scan failed. Sensitive-looking material was found:');
  for (const finding of findings) {
    console.error(`- ${finding.path}:${finding.line} (${finding.kind})`);
  }
  console.error('Matched values are intentionally omitted.');
  process.exit(1);
}

console.log('Secret scan passed: no sensitive-looking task or tracked content found.');
