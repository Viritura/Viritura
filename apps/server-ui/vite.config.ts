import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  oxc: { target: "es2022" },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
    minify: "esbuild",
    cssMinify: "esbuild",
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "src/main.tsx"),
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
