import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import path from 'path'

export default defineConfig({
  plugins: [
    dts({
      include: ['src/**/*'],
      exclude: [
        '**/*.test.ts',
        'tests/**/*'
      ]
    })
  ],
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        'adapters/index': path.resolve(__dirname, 'src/adapters/index.ts'),
        'mcp/index': path.resolve(__dirname, 'src/mcp/index.ts'),
        'server/index': path.resolve(__dirname, 'src/server/index.ts'),
      },
      formats: ['es', 'cjs']
    },
    sourcemap: true,
    rollupOptions: {
      external: [
        'fs', 'fs/promises', 'path', 'child_process', 'os', 'url', 'crypto',
        'ssh2', 'node-fuse-bindings', 'util', 'events',
        '@modelcontextprotocol/sdk/server/mcp.js',
        '@modelcontextprotocol/sdk/server/stdio.js',
        '@modelcontextprotocol/sdk/server/streamableHttp.js',
        '@modelcontextprotocol/sdk/client/index.js',
        '@modelcontextprotocol/sdk/client/stdio.js',
        '@modelcontextprotocol/sdk/client/streamableHttp.js',
        '@ai-sdk/mcp',
        'express', 'zod', 'minimatch'
      ],
      output: {
        exports: 'auto',
        sourcemapExcludeSources: false
      }
    },
    target: 'node18',
    ssr: true
  },
  define: {
    global: 'globalThis'
  }
})