import { initWasm, isWasmReady, loadMusicFont, GlyphAtlas, PageCache } from "@viritura/renderer";
import { createLayoutBackend, type LayoutBackend } from "./layoutBackend";

interface InitArgs {
  atlasFontSize: number;
  backendRef: { current: LayoutBackend | null };
  glyphAtlasRef: { current: GlyphAtlas | null };
  pageCacheRef: { current: PageCache | null };
  /** Initial layout-debug sidecar flag (mirrors the layout debug store). */
  emitLayoutDebug: boolean;
  /** Reuse the worker across brief unmount/remount gaps, such as Storybook navigation. */
  keepLayoutBackendAlive: boolean;
  setWasmReady: (ready: boolean) => void;
}

const BACKEND_KEEP_ALIVE_MS = 1_000;
let sharedBackendPromise: Promise<LayoutBackend> | null = null;
let sharedBackendConsumers = 0;
let sharedBackendDisposeTimer: ReturnType<typeof setTimeout> | undefined;

function acquireSharedBackend(emitLayoutDebug: boolean): Promise<LayoutBackend> {
  clearTimeout(sharedBackendDisposeTimer);
  sharedBackendDisposeTimer = undefined;
  sharedBackendConsumers += 1;
  sharedBackendPromise ??= createLayoutBackend(emitLayoutDebug).catch((error: unknown) => {
    sharedBackendPromise = null;
    throw error;
  });
  return sharedBackendPromise.then((backend) => {
    backend.setEmitLayoutDebug(emitLayoutDebug);
    return backend;
  });
}

function releaseSharedBackend(): void {
  sharedBackendConsumers = Math.max(0, sharedBackendConsumers - 1);
  if (sharedBackendConsumers > 0) return;
  sharedBackendDisposeTimer = setTimeout(() => {
    if (sharedBackendConsumers > 0) return;
    const backendPromise = sharedBackendPromise;
    sharedBackendPromise = null;
    sharedBackendDisposeTimer = undefined;
    void backendPromise?.then(
      (backend) => backend.dispose(),
      () => undefined,
    );
  }, BACKEND_KEEP_ALIVE_MS);
}

/**
 * Mount-time bootstrap: initialise the main-thread WASM engine (for export /
 * diff / fallback), load the SMuFL font, create the layout backend (worker by
 * default, synchronous fallback otherwise), and build the glyph atlas + page
 * cache. Returns a cleanup function that disposes the backend.
 */
export function initWasmAndFont(args: InitArgs): () => void {
  const {
    atlasFontSize,
    backendRef,
    glyphAtlasRef,
    pageCacheRef,
    emitLayoutDebug,
    keepLayoutBackendAlive,
    setWasmReady,
  } = args;
  let disposed = false;
  let sharedBackendAcquired = false;
  void Promise.all([initWasm(), loadMusicFont()]).then(async () => {
    if (disposed) return;
    // Create the layout backend (worker preferred; main-thread fallback). The
    // worker initialises its own WASM copy independently of the main thread.
    sharedBackendAcquired = keepLayoutBackendAlive;
    const backend = await (keepLayoutBackendAlive
      ? acquireSharedBackend(emitLayoutDebug)
      : createLayoutBackend(emitLayoutDebug));
    if (disposed) {
      if (!keepLayoutBackendAlive) backend.dispose();
      return;
    }
    backendRef.current = backend;
    setWasmReady(isWasmReady() && backend.isReady());

    // Build glyph atlas after font is loaded
    if (typeof OffscreenCanvas !== "undefined") {
      try {
        const dpr = window.devicePixelRatio || 1;
        const atlas = new GlyphAtlas({
          fontSize: atlasFontSize,
          // Glyphs are re-baked at the live `dpr * zoom` before each frame
          // (see ensureDeviceScale); this is just the initial bake.
          deviceScale: dpr,
          atlasWidth: 4096,
          atlasHeight: 4096,
        });
        atlas.build();
        glyphAtlasRef.current = atlas;

        const cache = new PageCache(atlas);
        pageCacheRef.current = cache;
      } catch {
        // OffscreenCanvas not supported — fall back to direct rendering
      }
    }
  });
  return () => {
    disposed = true;
    if (sharedBackendAcquired) {
      releaseSharedBackend();
    } else {
      backendRef.current?.dispose();
    }
    backendRef.current = null;
  };
}
