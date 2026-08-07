import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The quality harnesses are slow — thousands of simulated rollouts, and
    // ~2,900 scored offers — so they are opt-in via `npm run validate` rather
    // than part of every run.
    exclude: ['**/node_modules/**', '**/validate-advice.test.ts', '**/coverage.test.ts'],
  },
});
