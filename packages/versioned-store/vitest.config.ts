import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Integration tests need a live S3 (localstack/MinIO) — run via test:integration.
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
