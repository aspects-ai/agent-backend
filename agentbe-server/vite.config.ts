import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import path from 'path'

export default defineConfig({
  plugins: [
    dts({
      include: ['src/**/*'],
      exclude: ['**/*.test.ts', 'tests/**/*']
    })
  ],
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, 'src/index.ts'),
        'mcp/servers/LocalFilesystemMCPServer': path.resolve(__dirname, 'src/mcp/servers/LocalFilesystemMCPServer.ts'),
        'mcp/servers/RemoteFilesystemMCPServer': path.resolve(__dirname, 'src/mcp/servers/RemoteFilesystemMCPServer.ts'),
        'mcp/servers/MemoryMCPServer': path.resolve(__dirname, 'src/mcp/servers/MemoryMCPServer.ts'),
        // TODO: Add CLI entry point when mcp/cli/server.ts is created
        // 'mcp/cli/server': path.resolve(__dirname, 'src/mcp/cli/server.ts'),
      },
      formats: ['es', 'cjs']
    },
    sourcemap: true,
    rollupOptions: {
      external: [
        'fs', 'fs/promises', 'path', 'child_process', 'os', 'url', 'crypto',
        'constellationfs',
        '@modelcontextprotocol/sdk/server/mcp.js',
        '@modelcontextprotocol/sdk/server/stdio.js',
        '@modelcontextprotocol/sdk/server/streamableHttp.js',
        '@modelcontextprotocol/sdk/client/index.js',
        '@modelcontextprotocol/sdk/client/stdio.js',
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
