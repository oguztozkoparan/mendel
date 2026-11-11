import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The git integration tests spawn many git processes; on a slow Windows CI runner one test can pass vitest's 5 s default.
  test: { include: ['test/**/*.test.ts'], environment: 'node', testTimeout: 20_000 }
})
