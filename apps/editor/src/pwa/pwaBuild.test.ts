// @vitest-environment node
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createContext, runInContext, runInNewContext } from "node:vm";
import { build } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { describe, expect, it, vi } from "vitest";
import { createPwaOptions, pwaOptions, stagePwaIcons } from "../../pwa";

function workerCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const requestUrl = (request: Request | string): string => (typeof request === "string" ? request : request.url);
  return {
    async match(request: Request | string, options?: { cacheName?: string }) {
      for (const [name, entries] of stores) {
        if (options?.cacheName && options.cacheName !== name) continue;
        const response = entries.get(requestUrl(request));
        if (response) return response.clone();
      }
      return undefined;
    },
    async open(name: string) {
      let store = stores.get(name);
      if (!store) {
        store = new Map<string, Response>();
        stores.set(name, store);
      }
      const entries = store;
      return {
        async match(request: Request | string) {
          return entries.get(requestUrl(request))?.clone();
        },
        async put(request: Request | string, response: Response) {
          entries.set(requestUrl(request), response.clone());
        },
        async keys() {
          return [...entries.keys()].map((url) => new Request(url));
        },
        async delete(request: Request | string) {
          return entries.delete(requestUrl(request));
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
}

class RuntimeWorkerEvent {
  readonly pending: Promise<unknown>[] = [];
  response: Promise<Response> | undefined;

  constructor(
    readonly type: string,
    readonly request?: Request,
  ) {}
  waitUntil(promise: Promise<unknown>): void {
    this.pending.push(promise);
  }
  respondWith(response: Promise<Response> | Response): void {
    this.response = Promise.resolve(response);
  }
}

class RuntimeWorkerRequest extends Request {
  constructor(input: Request | string | URL, init?: RequestInit) {
    super(typeof input === "string" ? new URL(input, "https://app.viritura.test/sw.js") : input, init);
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return value instanceof Request;
  }
}

async function startWorker(
  dist: string,
  caches: ReturnType<typeof workerCaches>,
  fetchAsset: (request: Request) => Promise<Response>,
) {
  const listeners = new Map<string, Array<(event: RuntimeWorkerEvent) => void>>();
  const context = createContext({
    URL,
    URLSearchParams,
    Request: RuntimeWorkerRequest,
    Response,
    Headers,
    console,
    ExtendableEvent: RuntimeWorkerEvent,
    FetchEvent: RuntimeWorkerEvent,
    location: new URL("https://app.viritura.test/sw.js"),
    registration: { scope: "https://app.viritura.test/" },
    clients: { claim: async () => {} },
    caches,
    fetch: fetchAsset,
    setTimeout,
    clearTimeout,
    __WB_DISABLE_DEV_LOGS: true,
    skipWaiting: vi.fn(),
    addEventListener(type: string, listener: (event: RuntimeWorkerEvent) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  });
  context.self = context;
  context.importScripts = (url: string) => {
    const path = new URL(url, context.location).pathname.slice(1).split("/");
    runInContext(readFileSync(resolve(dist, ...path), "utf8"), context);
  };
  runInContext(readFileSync(resolve(dist, "sw.js"), "utf8"), context);
  await new Promise<void>((done) => setImmediate(done));
  return {
    async dispatch(type: string, request?: Request): Promise<Response | undefined> {
      const event = new RuntimeWorkerEvent(type, request);
      for (const listener of listeners.get(type) ?? []) listener(event);
      const response = await event.response;
      await Promise.all(event.pending);
      return response;
    },
  };
}

describe("production PWA assets", () => {
  it.each([undefined, " https://assets.viritura.com/// "])(
    "precaches offline playback with asset base %s",
    async (assetBaseUrl) => {
      const root = mkdtempSync(resolve(tmpdir(), "viritura-pwa-test-"));
      try {
        const publicRoot = resolve(root, "public");
        for (const directory of ["wasm", "fonts", "scores", "sounds/ir", "denigma"]) {
          mkdirSync(resolve(publicRoot, directory), { recursive: true });
        }
        writeFileSync(resolve(root, "index.html"), "<html><head></head><body>Viritura</body></html>");
        writeFileSync(resolve(publicRoot, "wasm", "engine.wasm"), new Uint8Array(3 * 1024 * 1024));
        writeFileSync(resolve(publicRoot, "wasm", "engine.js"), "export default {}");
        writeFileSync(resolve(publicRoot, "fonts", "Bravura.otf"), "test font");
        writeFileSync(resolve(publicRoot, "scores", "example.mnx"), "{}");
        writeFileSync(resolve(publicRoot, "sounds", "library.sf2"), "not precached");
        const soundfont = Buffer.alloc(33 * 1024 * 1024);
        soundfont.write("RIFF", 0);
        soundfont.write("sfbk", 8);
        const soundfontPath = resolve(root, "canonical.sf2");
        writeFileSync(soundfontPath, soundfont);
        if (!assetBaseUrl) writeFileSync(resolve(publicRoot, "sounds", "Shan-SGM-Pro-15.sf2"), soundfont);
        writeFileSync(resolve(publicRoot, "sounds", "viritura-sf2-processor.js"), "test scheduling worklet");
        writeFileSync(resolve(publicRoot, "sounds", "spessasynth_processor.min.js"), "test vendor worklet");
        writeFileSync(resolve(publicRoot, "sounds", "ir", "french-salon.wav"), "test reverb");
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
        const options = createPwaOptions(soundfontPath, assetBaseUrl);
        const sf2Url = `${assetBaseUrl ? "https://assets.viritura.com" : ""}/sounds/Shan-SGM-Pro-15.sf2`;
        expect(options.workbox?.additionalManifestEntries).toEqual([
          {
            url: sf2Url,
            revision: createHash("sha256").update(soundfont).digest("hex"),
          },
        ]);
        expect(soundfont.length).toBeGreaterThan(options.workbox?.maximumFileSizeToCacheInBytes ?? 0);
        await build({ root, configFile: false, logLevel: "silent", plugins: [VitePWA(options)] });
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
          "sounds/viritura-sf2-processor.js",
          "sounds/spessasynth_processor.min.js",
          "sounds/ir/french-salon.wav",
          sf2Url,
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

        const caches = workerCaches();
        const fetchAsset = vi.fn(async (request: Request) => {
          const url = new URL(request.url);
          const path = url.pathname.endsWith(".sf2")
            ? soundfontPath
            : resolve(dist, ...url.pathname.slice(1).split("/"));
          return new Response(readFileSync(path), {
            headers: { "Cross-Origin-Resource-Policy": "cross-origin" },
          });
        });
        const initial = await startWorker(dist, caches, fetchAsset);
        await initial.dispatch("install");
        await initial.dispatch("activate");
        expect(fetchAsset.mock.calls.map(([request]) => new URL(request.url).pathname)).toContain(
          "/sounds/Shan-SGM-Pro-15.sf2",
        );
        fetchAsset.mockClear();
        fetchAsset.mockRejectedValue(new Error("offline"));
        // A fresh worker realm shares only persistent CacheStorage, not an in-memory SF2 buffer.
        const relaunched = await startWorker(dist, caches, fetchAsset);
        const navigation = new Request("https://app.viritura.test/?open-file=1");
        Object.defineProperty(navigation, "mode", { value: "navigate" });
        const shell = await relaunched.dispatch("fetch", navigation);
        expect(await shell?.text()).toContain("Viritura");
        const cachedSf2 = await relaunched.dispatch("fetch", new Request(new URL(sf2Url, "https://app.viritura.test")));
        expect(cachedSf2?.status).toBe(200);
        expect(cachedSf2?.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin");
        expect(Buffer.from(await cachedSf2!.arrayBuffer())).toEqual(soundfont);
        for (const path of [
          "sounds/viritura-sf2-processor.js",
          "sounds/spessasynth_processor.min.js",
          "sounds/ir/french-salon.wav",
        ]) {
          const response = await relaunched.dispatch("fetch", new Request(`https://app.viritura.test/${path}`));
          expect(response?.status).toBe(200);
        }
        expect(fetchAsset).not.toHaveBeenCalled();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    60000,
  );

  it("rejects a Git LFS pointer instead of claiming the sound library is cached", () => {
    const root = mkdtempSync(resolve(tmpdir(), "viritura-sf2-pointer-test-"));
    try {
      const path = resolve(root, "pointer.sf2");
      writeFileSync(path, "version https://git-lfs.github.com/spec/v1\n");
      expect(() => createPwaOptions(path)).toThrow("Run git lfs pull");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
