import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/performance",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    headless: false,
    channel: "chrome",
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    trace: "off",
    video: "off",
    launchOptions: {
      args: [
        "--window-position=40,40",
        "--window-size=1440,980",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
      ],
    },
  },
  projects: [{ name: "headed-chrome", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @viritura/editor exec vite preview --host 127.0.0.1 --port 4174 --strictPort",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
