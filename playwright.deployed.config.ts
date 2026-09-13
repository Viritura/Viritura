import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/deployed",
  fullyParallel: true,
  forbidOnly: true,
  retries: 2,
  workers: 2,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  outputDir: "test-results/deployed",
  use: {
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [{ name: "pages-chromium", use: { ...devices["Desktop Chrome"] } }],
});
