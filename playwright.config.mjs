import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30000,
  reporter: 'list',
  outputDir: '.ci-results/browser-e2e',
  use: { browserName: 'chromium', headless: true, trace: 'off', screenshot: 'off', video: 'off' },
  // Traces/screenshots may retain generated credentials. Capture only deliberately sanitized evidence.
});
