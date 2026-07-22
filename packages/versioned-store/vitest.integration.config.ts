import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.integration.test.ts"],
    // S3 round-trips over the network; give them room.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
