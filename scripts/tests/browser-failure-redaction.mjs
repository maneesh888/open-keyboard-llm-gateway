// A deliberately failing browser test must not persist credential-bearing DOM state.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
const root = resolve('.');
mkdirSync(join(root, '.ci-results'), { recursive: true });
const directory = mkdtempSync(join(root, '.ci-results/browser-redaction-'));
const canary = randomBytes(32).toString('hex');
try {
  writeFileSync(join(directory, 'failure.spec.mjs'), `import { test } from '@playwright/test';\ntest('intentional failure after a credential is visible', async ({ page }) => {\n  await page.setContent('<button>Copy</button><div>' + process.env.GATEWAY_REDACTION_CANARY + '</div>');\n  await page.getByRole('button', { name: 'Copy' }).click();\n  throw new Error('Intentional failure for credential-retention verification');\n});\n`);
  writeFileSync(join(directory, 'config.mjs'), `import base from ${JSON.stringify(join(root, 'playwright.config.mjs'))};\nexport default { ...base, testDir: '.', outputDir: './results' };\n`);
  const run = spawnSync(process.execPath, [join(root, 'node_modules/playwright/cli.js'), 'test', '--config', join(directory, 'config.mjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, GATEWAY_REDACTION_CANARY: canary }, timeout: 60000,
  });
  if (run.status !== 1 || !run.stdout?.includes('1 failed') || !(run.stdout + run.stderr).includes('Intentional failure for credential-retention verification')) throw new Error('Expected browser failure was not exercised.');
  const contents = [run.stdout, run.stderr];
  function inspect(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) inspect(child); else contents.push(readFileSync(child, 'utf8'));
    }
  }
  inspect(directory);
  if (contents.some(value => value.includes(canary))) throw new Error('Browser failure retained the credential canary.');
  console.log('Expected browser failure exercised; reporter and retained files contain no DOM credential canary.');
} finally { rmSync(directory, { recursive: true, force: true }); }
