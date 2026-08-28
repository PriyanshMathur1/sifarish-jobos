import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  // Dev-server cold compiles routinely exceed the 5s default in CI containers.
  expect: { timeout: 20_000 },
  workers: 1, // tests share one database — serialize files
  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    // In environments with a preinstalled Chromium (CI containers), point at it
    // via PW_CHROMIUM_PATH instead of downloading a browser.
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
  },
  webServer: {
    command: "pnpm --filter @jobos/web dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
