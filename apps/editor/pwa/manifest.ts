import type { VitePWAOptions } from "vite-plugin-pwa";

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
      "scores/*.mnx",
      "pwa-icons/*.png",
      "*.svg",
      "mnx-schema.json",
    ],
    // Engraving WASM and bundled editor chunks exceed Workbox's 2 MiB default.
    maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
    // Account/API traffic, source documents, and large sound libraries are not cached.
    runtimeCaching: [],
  },
  devOptions: { enabled: false },
};
