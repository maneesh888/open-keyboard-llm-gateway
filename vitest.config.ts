import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      '**/.claude/**',
      '**/.claire/**',
      '**/Vendor/**',
      '**/tests/e2e/**',
    ],
  },
});
