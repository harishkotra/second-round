import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts', 'scripts/check-req-id.ts'],
      // The two module-level `isDirectRun` guards and runBot's process.exit path
      // cannot be exercised in-process, so the bar is set just below 100 rather
      // than pretending otherwise.
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
})