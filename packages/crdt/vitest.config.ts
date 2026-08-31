import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Structural Yjs projections can exceed Vitest's 5-second default when all
    // workspace suites compete for CPU; isolated runs complete well below this.
    testTimeout: 15_000,
  },
});
