import { defineConfig } from "vite";
import { containerWatchOptions } from "../../infra/dev/viteWatch.ts";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { existsSync, readFileSync, statSync, rmSync } from "node:fs";
import path, { normalize, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { syncMnxFixtures, syncMnxSchema, syncSharedAssets, syncSounds } from "./buildAssets.ts";

syncSharedAssets();
syncSounds();
syncMnxSchema();
syncMnxFixtures();

function serveContainerPublicFiles(): Plugin {
  const publicRoot = resolve(__dirname, "public");
  const contentTypes: Record<string, string> = {
    ".css": "text/css",
    ".gif": "image/gif",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript",
    ".json": "application/json",
    ".mnx": "application/json",
    ".mp3": "audio/mpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };

  return {
    name: "viritura-serve-container-public-files",
    configureServer(server) {
      if (!containerHost) return;

      server.middlewares.use((req, res, next) => {
        const requestPath = (req.url ?? "/").split("?")[0];
        let decodedPath: string;
        try {
          decodedPath = decodeURIComponent(requestPath);
        } catch {
          return next();
        }

        const target = normalize(resolve(publicRoot, `.${decodedPath}`));
        if (!target.startsWith(publicRoot + sep) && target !== publicRoot) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        let stat;
        try {
          stat = statSync(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            next();
            return;
          }
          next(error);
          return;
        }
        if (!stat.isFile()) {
          next();
          return;
        }

        const body = readFileSync(target);
        res.statusCode = 200;
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Content-Length", String(body.byteLength));
        res.setHeader("Content-Type", contentTypes[path.extname(target).toLowerCase()] ?? "application/octet-stream");
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        res.end(body);
      });
    },
  };
}

function externalizeLargeSoundfont() {
  return {
    name: "viritura-externalize-large-soundfont",
    closeBundle() {
      if (process.env.VIRITURA_EXTERNAL_SOUNDFONT !== "true") return;
      rmSync(path.resolve(__dirname, "dist/sounds/Shan-SGM-Pro-15.sf2"), { force: true });
    },
  };
}

// When run inside a per-worktree dev container (infra/dev), Traefik terminates
// the request at <role>.<slug>.localhost:80 and forwards to this server. The
// var's presence flips on proxy-aware settings; when unset (normal host runs)
// every server option below stays exactly as it was.
const containerHost = process.env.VIRITURA_CONTAINER_HOST;
const wasmAssetVersionPath = resolve(__dirname, "public/wasm/asset-version.json");
const wasmAssetHash = existsSync(wasmAssetVersionPath)
  ? (JSON.parse(readFileSync(wasmAssetVersionPath, "utf8")) as { assetHash: string }).assetHash
  : "";

export default defineConfig({
  define: {
    __VIRITURA_WASM_ASSET_HASH__: JSON.stringify(wasmAssetHash),
  },
  plugins: [
    serveContainerPublicFiles(),
    // Vite 8's plugin-react handles JSX + Fast Refresh via Oxc; the React
    // Compiler still runs through Babel, wired in with @rolldown/plugin-babel
    // and the plugin's own `reactCompilerPreset` (preconfigured filter).
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    externalizeLargeSoundfont(),
  ],
  // The editor is served at its own origin (app.viritura.com in prod,
  // localhost:5173 in dev), so it always lives at the root path.
  base: "/",
  // esbuild/Oxc 0.28.x-era lowering refuses to down-level certain destructuring
  // patterns in our deps (Monaco, Radix, floating-ui) to Vite's default target.
  // An explicit modern target sidesteps the broken lowering — the editor already
  // requires a recent browser (WASM threads, SharedArrayBuffer, Canvas) so es2022
  // costs no real reach. (`oxc` is Vite 8's successor to the `esbuild` option.)
  oxc: { target: "es2022" },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
    // Vite 8's default CSS minifier removes the standards-based
    // `backdrop-filter` declaration and leaves only `-webkit-backdrop-filter`.
    // Edge then computes no filter, so production loses the glass blur that
    // the unminified development stylesheet has. esbuild preserves both.
    cssMinify: "esbuild",
  },
  server: {
    port: 5173,
    strictPort: true,
    // No browser to open inside a container; open normally on the host.
    open: !containerHost,
    // In a container, listen on all interfaces, accept the *.localhost vhost,
    // and point HMR at Traefik's :80 so the websocket reaches this server.
    host: containerHost ? true : undefined,
    allowedHosts: containerHost ? [".localhost"] : undefined,
    hmr: containerHost ? { host: containerHost, clientPort: 80, protocol: "ws" } : undefined,
    // Polling, scoped. See infra/dev/viteWatch.ts -- unscoped polling starves
    // the dev server's event loop and slows every request, not just the watcher.
    watch: containerWatchOptions(containerHost),
    headers: {
      // Required for SharedArrayBuffer (WASM threading)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    port: 3000,
    strictPort: true,
    headers: {
      // Same cross-origin isolation as dev — the layout worker + SharedArrayBuffer
      // need these in the production preview too.
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  resolve: {
    alias: {
      // Resolve the WASM package
      "@viritura/engine-wasm": path.resolve(__dirname, "../../engine/viritura-wasm"),
    },
  },
  optimizeDeps: {
    exclude: ["@viritura/engine-wasm"],
    include: ["spessasynth_core", "spessasynth_lib"],
    esbuildOptions: { target: "es2022" },
  },
});
