// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { describe, expect, it, vi } from "vitest";
import { pwaOptions, stagePwaIcons } from "../../pwa";

describe("production PWA assets", () => {
  it("generates installable icons and an offline shell without caching playback or user data", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "viritura-pwa-test-"));
    try {
      const publicRoot = resolve(root, "public");
      for (const directory of ["wasm", "fonts", "scores", "sounds", "denigma"]) {
        mkdirSync(resolve(publicRoot, directory), { recursive: true });
      }
      writeFileSync(resolve(root, "index.html"), "<html><head></head><body>Viritura</body></html>");
      writeFileSync(resolve(publicRoot, "wasm", "engine.wasm"), new Uint8Array(3 * 1024 * 1024));
      writeFileSync(resolve(publicRoot, "wasm", "engine.js"), "export default {}");
      writeFileSync(resolve(publicRoot, "fonts", "Bravura.otf"), "test font");
      writeFileSync(resolve(publicRoot, "scores", "example.mnx"), "{}");
      writeFileSync(resolve(publicRoot, "sounds", "library.sf2"), "not precached");
      writeFileSync(resolve(publicRoot, "denigma", "denigma.wasm"), "not precached");
      stagePwaIcons(resolve(__dirname, "../../../../assets/branding"), publicRoot);
      for (const [name, size] of [
        ["icon-192.png", 192],
        ["icon-512.png", 512],
        ["maskable-512.png", 512],
        ["apple-touch-icon.png", 180],
      ] as const) {
        const png = readFileSync(resolve(publicRoot, "pwa-icons", name));
        expect(png.subarray(1, 4).toString()).toBe("PNG");
        expect(png.readUInt32BE(16)).toBe(size);
        expect(png.readUInt32BE(20)).toBe(size);
      }
      await build({ root, configFile: false, logLevel: "silent", plugins: [VitePWA(pwaOptions)] });
      const dist = resolve(root, "dist");
      const manifest = JSON.parse(readFileSync(resolve(dist, "manifest.webmanifest"), "utf8"));
      expect(manifest).toMatchObject({
        id: "/",
        start_url: "/",
        scope: "/",
        display: "standalone",
        file_handlers: [
          { action: "/?open-file=1", accept: { "application/json": [".mnx"] }, launch_type: "multiple-clients" },
        ],
        launch_handler: { client_mode: "navigate-new" },
      });
      expect(manifest.icons).toHaveLength(3);
      expect(readFileSync(resolve(dist, "index.html"), "utf8")).toContain('rel="manifest"');
      const worker = readFileSync(resolve(dist, "sw.js"), "utf8");
      for (const asset of [
        "index.html",
        "wasm/engine.wasm",
        "wasm/engine.js",
        "fonts/Bravura.otf",
        "scores/example.mnx",
      ]) {
        expect(worker).toContain(asset);
      }
      expect(worker).not.toContain("library.sf2");
      expect(worker).not.toContain("denigma.wasm");
      const skipWaiting = vi.fn();
      const addEventListener = vi.fn();
      const define = (_dependencies: string[], factory: (workbox: object) => void): void => {
        factory({
          clientsClaim: vi.fn(),
          precacheAndRoute: vi.fn(),
          cleanupOutdatedCaches: vi.fn(),
          registerRoute: vi.fn(),
          NavigationRoute: vi.fn(),
          createHandlerBoundToURL: vi.fn(),
        });
      };
      runInNewContext(worker, { self: { define, skipWaiting, addEventListener }, define });
      expect(skipWaiting).not.toHaveBeenCalled();
      expect(addEventListener).toHaveBeenCalledWith("message", expect.any(Function));
      expect(pwaOptions.workbox?.skipWaiting).toBe(false);
      expect(pwaOptions.workbox?.runtimeCaching).toEqual([]);
      expect(pwaOptions.devOptions?.enabled).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60000);
});
