import { defineConfig, type Plugin } from "vite";
import { containerWatchOptions } from "../../infra/dev/viteWatch.ts";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

function externalizeLargeSoundfont(): Plugin {
  return {
    name: "viritura-externalize-large-soundfont",
    closeBundle() {
      if (process.env.VIRITURA_EXTERNAL_SOUNDFONT !== "true") return;
      rmSync(resolve(__dirname, "dist/sounds/Shan-SGM-Pro-15.sf2"), { force: true });
    },
  };
}

// See apps/editor/vite.config.ts — set inside the infra/dev worktree
// container so Traefik can route web.<slug>.localhost to this server. Unset on
// normal host runs, leaving the server options untouched.
const containerHost = process.env.VIRITURA_CONTAINER_HOST;

export default defineConfig({
  plugins: [
    // Vite 8's plugin-react handles JSX + Fast Refresh via Oxc; the React
    // Compiler still runs through Babel, wired in with @rolldown/plugin-babel
    // and the plugin's own `reactCompilerPreset` (preconfigured filter).
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    externalizeLargeSoundfont(),
  ],
  base: "/",
  // Explicit modern transform target. `oxc` is Vite 8's successor to the
  // `esbuild` option; the app already requires a recent browser (WASM, Canvas,
  // SharedArrayBuffer) so es2022 costs no real reach and sidesteps broken
  // destructuring lowering in some deps.
  oxc: { target: "es2022" },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
    cssCodeSplit: false,
    // Vite 8's default CSS minifier drops paired `backdrop-filter`
    // declarations. esbuild preserves the prefixed-first fallback pairs.
    cssMinify: "esbuild",
  },
  optimizeDeps: {
    esbuildOptions: { target: "es2022" },
  },
  server: {
    port: 5180,
    strictPort: true,
    open: !containerHost,
    host: containerHost ? true : undefined,
    allowedHosts: containerHost ? [".localhost"] : undefined,
    hmr: containerHost ? { host: containerHost, clientPort: 80, protocol: "ws" } : undefined,
    // Polling, scoped. See infra/dev/viteWatch.ts -- unscoped polling starves
    // the dev server's event loop and slows every request, not just the watcher.
    watch: containerWatchOptions(containerHost),
  },
});
