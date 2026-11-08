import type { VitePWAOptions } from "vite-plugin-pwa";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: "prompt",
  injectRegister: false,
  manifest: {
    id: "/",
    name: "Viritura",
    short_name: "Viritura",
    description: "Compose, engrave, and edit music notation.",
    lang: "en",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#215e4e",
    theme_color: "#215e4e",
    icons: [
      { src: "/pwa-icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    file_handlers: [
      {
        action: "/?open-file=1",
        accept: { "application/json": [".mnx"] },
        launch_type: "multiple-clients",
      },
    ],
    launch_handler: { client_mode: "navigate-new" },
  },
  workbox: {
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: false,
    navigateFallback: "index.html",
    // Never serve the editor HTML in place of an asset or an API response.
    navigateFallbackDenylist: [/^\/(?:api|assets|wasm|fonts|sounds|denigma|scores|pwa-icons)(?:\/|$)/],
    globPatterns: [
      "index.html",
      "assets/**/*.{js,css,wasm,woff,woff2,ttf,otf}",
      "wasm/*.{js,wasm,json}",
      "fonts/*.{otf,ttf,json}",
      "sounds/**/*.{js,wav}",
      "scores/*.mnx",
      "pwa-icons/*.png",
      "*.svg",
      "mnx-schema.json",
    ],
    // Engraving WASM and bundled editor chunks exceed Workbox's 2 MiB default.
    maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
    // Account/API traffic and user documents are not cached.
    runtimeCaching: [],
  },
  devOptions: { enabled: false },
};

export function createPwaOptions(soundfontPath: string, assetBaseUrl?: string): Partial<VitePWAOptions> {
  const soundfont = readFileSync(soundfontPath);
  if (soundfont.toString("ascii", 0, 4) !== "RIFF" || soundfont.toString("ascii", 8, 12) !== "sfbk") {
    throw new Error("PWA playback caching requires the real bundled SF2. Run git lfs pull and rebuild.");
  }
  const base = assetBaseUrl?.trim().replace(/\/+$/, "");
  return {
    ...pwaOptions,
    workbox: {
      ...pwaOptions.workbox,
      // The 119 MiB SF2 exceeds the glob size limit and may live on the CDN, not Pages.
      additionalManifestEntries: [
        {
          url: `${base || ""}/sounds/Shan-SGM-Pro-15.sf2`,
          revision: createHash("sha256").update(soundfont).digest("hex"),
        },
      ],
    },
  };
}
