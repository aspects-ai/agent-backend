import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.integration.test.ts"],
    // Local model may download on first run.
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
