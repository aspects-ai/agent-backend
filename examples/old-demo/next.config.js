/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  experimental: {
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },
  serverExternalPackages: [
    '@anthropic-ai/sdk',
    '@codebuff/sdk',
    'ssh2',
    'node-fuse-bindings',
    'agent-backend'
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ignore tree-sitter WASM files on server
      config.resolve.alias = {
        ...config.resolve.alias,
        'tree-sitter.wasm': false,
      }

      // Mark native dependencies as external for server-side
      config.externals.push(
        'ssh2',
        'node-fuse-bindings',
        'cpu-features'
      )

      // Ignore native modules that can't be bundled
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'cpu-features': false,
        'utf-8-validate': false,
        'bufferutil': false
      }
    }

    // Handle WASM files
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'webassembly/async',
    })

    // Enable WebAssembly experiments
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      syncWebAssembly: true,
    }

    // Handle .scm files (Tree-sitter query files)
    config.module.rules.push({
      test: /\.scm$/,
      type: 'asset/source',
    })

    // Configure webpack cache to use filesystem instead of memory
    // This eliminates the "Serializing big strings" warnings
    config.cache = {
      type: 'filesystem',
      buildDependencies: {
        config: [__filename],
      },
      // Optional: customize cache settings
      compression: 'gzip', // Compress cache files
      hashAlgorithm: 'xxhash64', // Faster hashing
      maxAge: 60000 * 60 * 24 * 7, // 1 week
      maxMemoryGenerations: 1, // Minimize memory usage
    }

    return config
  }
}

module.exports = nextConfig