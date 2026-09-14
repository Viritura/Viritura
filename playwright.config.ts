import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

/**
 * Playwright config for end-to-end tests.
 *
 * Scope: Chromium-only — the editor relies on the File System Access API
 * (Chromium-exclusive), so cross-browser coverage would test code paths
 * that don't ship.
 *
 * Dev server: reuses an existing server on :5173 when one is already
 * running (typical local-dev), otherwise boots one with `pnpm dev:editor`.
 * The startup timeout is generous because cold Vite + WASM compile takes
 * a beat on first run.
 */
export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["performance/**", "deployed/**"],
  fullyParallel: false, // collaboration tests need deterministic ordering
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // single worker keeps two-peer signaling rooms isolated
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/functional",
  use: {
    baseURL: externalBaseUrl ?? "http://localhost:5173",
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "pnpm dev:editor",
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "ignore",
        stderr: "pipe",
        env: {
          VITE_VIRITURA_API_BASE_URL: "http://localhost:5173/__test-api",
        },
      },
});
