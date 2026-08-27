import { defineConfig } from "vitest/config";

const integration = process.env.VITEST_MODE === "integration";

export default defineConfig({
  test: {
    environment: "node",
    include: integration
      ? ["packages/**/src/**/*.integration.test.ts", "apps/**/src/**/*.integration.test.ts"]
      : ["packages/**/src/**/*.test.ts", "apps/**/src/**/*.test.ts"],
    exclude: integration
      ? ["**/node_modules/**"]
      : ["**/node_modules/**", "**/*.integration.test.ts"],
    fileParallelism: !integration,
    hookTimeout: integration ? 60000 : 10000,
    testTimeout: integration ? 60000 : 10000,
  },
});
