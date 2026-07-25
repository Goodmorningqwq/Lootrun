import { defineConfig } from 'vitest/config';

/** Config for the opt-in advice-quality harness (`npm run validate`). */
export default defineConfig({
  test: {
    include: ['engine/validate-advice.test.ts'],
    testTimeout: 180_000,
  },
});
