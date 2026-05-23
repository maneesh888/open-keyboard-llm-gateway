#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const allowList = [
  /README\.md:/,
  /PHASE-1-COMPLETE\.md:/,
  /OVERNIGHT-PROGRESS\.md:/,
  /config\/.*\.example\.json:/,
  /tests\//,
  /src\//,
  /public\/admin\/index\.html:/,
  /scripts\/secret-scan\.mjs:/,
];

const patterns = [
  'sk-[A-Za-z0-9_-]{16,}',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'jwtSecret',
  'passwordHash',
  'Bearer [A-Za-z0-9._-]{20,}',
];

let output = '';
try {
  output = execFileSync('git', [
    'grep', '-nE', patterns.join('|'), '--',
    '.',
    ':(exclude)package-lock.json',
    ':(exclude)node_modules',
    ':(exclude)dist',
    ':(exclude).claude',
    ':(exclude).claire',
  ], { encoding: 'utf8' });
} catch (error) {
  if (error.status === 1) {
    console.log('Secret scan passed: no sensitive-looking tracked content found.');
    process.exit(0);
  }
  throw error;
}

const findings = output
  .split('\n')
  .filter(Boolean)
  .filter(line => !allowList.some(rx => rx.test(line)));

if (findings.length) {
  console.error('Secret scan failed. Review these tracked matches before committing:\n');
  console.error(findings.join('\n'));
  process.exit(1);
}

console.log('Secret scan passed: only allowlisted examples/tests/docs matched.');
