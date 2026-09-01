import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import { containerWatchOptions } from "../../infra/dev/viteWatch.ts";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

function externalizeLargeSoundfont() {
  return {
    name: "viritura-externalize-large-soundfont",
    closeBundle() {
      if (process.env.VIRITURA_EXTERNAL_SOUNDFONT !== "true") return;
      rmSync(resolve(import.meta.dirname, "dist/sounds/Shan-SGM-Pro-15.sf2"), { force: true });
    },
  };
}

const containerHost = process.env.VIRITURA_CONTAINER_HOST;

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [externalizeLargeSoundfont()],
    oxc: { target: "es2022" },
    build: {
      target: "es2022",
      sourcemap: false,
      cssCodeSplit: false,
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
      watch: containerWatchOptions(containerHost),
    },
  },
});