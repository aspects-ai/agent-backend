import path from 'path'
import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration for INTEGRATION TESTS
 *
 * Integration tests make real I/O operations:
 * - Spawn actual processes
 * - Write real files
 * - Make SSH connections (if server available)
 *
 * These tests are:
 * - Slow (seconds per test)
 * - Resource-intensive
 * - Platform-dependent
 *
 * IMPORTANT: Run these separately and sequentially to avoid EAGAIN errors
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/archive-v0.6/**'],

    // Critical: Prevent process exhaustion
    maxWorkers: 1,           // One worker only
    fileParallelism: false,  // Run test files sequentially
    maxConcurrency: 1,       // One test at a time

    testTimeout: 60000,      // Longer timeout for real I/O
    env: {
      AGENTBE_APP_ID: 'test-app-integration'
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
})
