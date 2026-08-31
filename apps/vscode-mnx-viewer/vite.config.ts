import { defineConfig } from "vite";
import path from "node:path";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

export default defineConfig({
  plugins: [
    // Vite 8's plugin-react handles JSX + Fast Refresh via Oxc; the React
    // Compiler still runs through Babel, wired in with @rolldown/plugin-babel
    // and the plugin's own `reactCompilerPreset`.
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    emptyOutDir: false,
    outDir: "media",
    sourcemap: false,
    lib: {
      entry: path.resolve(__dirname, "webview/viewer.tsx"),
      formats: ["iife"],
      name: "VirituraMnxViewer",
      fileName: () => "viewer.js",
      cssFileName: "viewer",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
