import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { cpSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const engineDist = join(dirname(require.resolve("@viritura/score-engine/package.json")), "dist");

export default defineConfig({
  plugins: [
    react(),
    {
      name: "published-score-engine-assets",
      configResolved(config) {
        cpSync(engineDist, join(config.publicDir, "score-engine"), { recursive: true });
      },
    },
  ],
});
