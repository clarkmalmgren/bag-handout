import { defineConfig } from 'vitest/config';

// Evaluation harness config: NOT part of `npm test` (which only includes tests/**).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['eval/**/*.eval.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
