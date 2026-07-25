import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The advice-quality harness runs thousands of simulated rollouts (~20s),
    // so it is opt-in via `npm run validate` rather than part of every run.
    exclude: ['**/node_modules/**', '**/validate-advice.test.ts'],
  },
});
