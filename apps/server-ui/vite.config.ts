import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { cssBuildOptions } from "../../scripts/cssBuild";

const configDirectory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  cacheDir: process.env.VIRITURA_VITE_CACHE_DIR,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  oxc: { target: "es2022" },
  build: {
    ...cssBuildOptions,
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
    minify: "esbuild",
    cssCodeSplit: false,
    lib: {
      entry: resolve(configDirectory, "src/main.tsx"),
      formats: ["es"],
      fileName: () => "server-ui.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: (asset) => (asset.names.includes("style.css") ? "server-ui.css" : "[name][extname]"),
      },
    },
  },
});
