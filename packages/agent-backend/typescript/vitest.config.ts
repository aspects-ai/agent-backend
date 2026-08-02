import path from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration for UNIT TESTS
 *
 * Unit tests mock all I/O operations (child_process, fs, ssh2, etc.)
 * They test logic, validation, and transformations without spawning processes.
 *
 * Benefits:
 * - No process spawning = no EAGAIN errors
 * - Fast execution (milliseconds per test)
 * - Platform-independent
 * - Can run hundreds of tests in parallel
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/unit/setup.ts'], // Global mocks and safeguards
    include: [
      'tests/unit/**/*.test.ts',
      'src/**/*.test.ts'
    ],
    exclude: [
      '**/node_modules/**',
      '**/archive-v0.6/**',
      '**/tests-integration-archive/**',
      '**/tests/integration/**' // Integration tests have separate config
    ],
    // No special concurrency limits needed - mocked tests are fast and safe
    testTimeout: 10000, // Faster timeout for unit tests
    env: {
      AGENTBE_APP_ID: 'test-app'
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
