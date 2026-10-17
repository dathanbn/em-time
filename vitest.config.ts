import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The DST and rollover tests are written for America/Los_Angeles. Run the suite a second time
// in another zone with `QA_TZ=UTC npx vitest run` (zone-specific cases skip themselves).
process.env.TZ = process.env.QA_TZ ?? 'America/Los_Angeles';

export default defineConfig({
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./frontend/src/core', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['frontend/src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
    env: { TZ: process.env.TZ },
  },
});
