import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // Phase A covers the requirement-ID gate only. src/ joins this list in
      // Phase B, once the ledger and bot core exist to be covered.
      include: ['scripts/check-req-id.ts'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 80,
        statements: 90,
      },
    },
  },
})