import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile local agent-backend package from TypeScript
  transpilePackages: ['agent-backend'],

  // Mark packages that should only run on the server (for Turbopack)
  serverExternalPackages: [
    "@ai-sdk/mcp",
    "ssh2",
    "cpu-features",
    "ws",
    "bufferutil",
    "utf-8-validate",
  ],

  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },

  // Empty turbopack config to silence warning when not using --webpack
  turbopack: {},

  // Webpack config for --webpack mode (debugging)
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || []
      config.externals.push({
        'ssh2': 'commonjs ssh2',
        'ws': 'commonjs ws',
        'bufferutil': 'commonjs bufferutil',
        'utf-8-validate': 'commonjs utf-8-validate',
      })
    }
    return config
  },
};

export default nextConfig;
