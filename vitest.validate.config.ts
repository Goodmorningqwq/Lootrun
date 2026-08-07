import { defineConfig } from 'vitest/config';

/** Config for the opt-in quality harnesses (`npm run validate`). */
export default defineConfig({
  test: {
    include: [
      'engine/validate-advice.test.ts',
      'engine/coverage.test.ts',
      'engine/aquaValue.test.ts',
    ],
    testTimeout: 180_000,
  },
});
