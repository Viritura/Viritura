import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    passWithNoTests: true,
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 15_000,
  },
});
