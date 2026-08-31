/**
 * Unified async layout backend for the score canvas.
 *
 * Abstracts over two implementations behind one async surface:
 *  - **Worker backend** (default): a {@link LayoutService} hosting the WASM
 *    module + retained-score engine on a dedicated Web Worker, so layout /
 *    parse / serialize never block the main thread.
 *  - **Main-thread backend** (fallback): the synchronous WASM engine, wrapped
 *    so its results resolve as promises. Used when the worker fails to load or
 *    the `viritura.layoutWorker` flag is disabled.
 *
 * The decision-only predicates the hot path needs synchronously
 * (`hasRetainedScore`, `cacheStats`) are mirrored on the main thread so the
 * typing path never pays a worker round-trip just to choose a code path.
 */

import {
  createCachedLayoutEngine,
  createLayoutService,
  decodeFrame,
  EMPTY_LAYOUT_METRICS,
  getScoreInfo as wasmGetScoreInfo,
  isWasmReady,
  PatchReconstructor,
  setEmitLayoutDebug as wasmSetEmitLayoutDebug,
  wasmComputeFullScoreLayout,
  wasmComputeLayout,
  wasmComputeMnxScoreLayout,
  type CachedLayoutEngine,
  type DisplayList,
  type LayoutService,
  type LayoutMetrics,
  type ScoreInfo,
} from "@viritura/renderer";

export interface LayoutBackend {
  /** True when the underlying engine is ready to lay out. */
  isReady(): boolean;
  /** True if running off the main thread (worker). */
  readonly isWorker: boolean;
  /** Sync mirror — true once a full/cached layout has retained a Score. */
  hasRetainedScore(): boolean;
  /** Last-known [hits, misses] (updated in the background for the worker). */
  cacheStats(): [number, number];
  /** Last-known deterministic work/transport counters. */
  layoutMetrics(): LayoutMetrics;

  getScoreInfo(mnxJson: string): Promise<ScoreInfo>;
  computeMnxScoreLayout(
    mnxJson: string,
    spatium: number,
    pageWidth: number,
    scoreIndex: number,
    pageSetupJson?: string,
  ): Promise<DisplayList>;
  computeLayout(
    mnxJson: string,
    partIndex: number,
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
  ): Promise<DisplayList>;
  computeFullScoreLayout(
    mnxJson: string,
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<DisplayList>;
  relayoutRetainedScore(
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<DisplayList | null>;
  applyPatchAndLayout(
    patchJson: string,
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<DisplayList>;
  fullLayout(
    mnxJson: string,
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<DisplayList>;
  invalidateCache(): void;
  setEmitLayoutDebug(enabled: boolean): void;
  dispose(): void;
}

const LAYOUT_WORKER_FLAG_KEY = "viritura.layoutWorker";

/**
 * Whether to run layout in a Web Worker. Defaults ON; set
 * `localStorage["viritura.layoutWorker"] = "0"` to force the synchronous
 * main-thread engine (e.g. to A/B a regression).
 */
function shouldUseLayoutWorker(): boolean {
  if (typeof Worker === "undefined") return false;
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(LAYOUT_WORKER_FLAG_KEY) === "0") {
      return false;
    }
  } catch {
    /* localStorage unavailable (private mode) — fall through to default */
  }
  return true;
}

/**
 * Create a layout backend, preferring the worker when enabled. Resolves once
 * the chosen backend is ready. Falls back to the synchronous main-thread
 * engine if the worker fails to initialize.
 *
 * The main-thread WASM module must already be initialized (for export / diff /
 * fallback) before calling — the worker initializes its own copy independently.
 */
export async function createLayoutBackend(emitLayoutDebug: boolean): Promise<LayoutBackend> {
  if (shouldUseLayoutWorker()) {
    const service = createLayoutService(emitLayoutDebug);
    try {
      const ok = await service.ready;
      if (ok) return makeWorkerBackend(service);
    } catch (e) {
      console.warn("[LayoutBackend] worker init failed, using main-thread engine:", e);
    }
    service.dispose();
  }
  return makeMainThreadBackend(emitLayoutDebug);
}

function makeWorkerBackend(service: LayoutService): LayoutBackend {
  const { engine } = service;
  let retained = false;
  let stats: [number, number] = [0, 0];
  let metrics: LayoutMetrics = { ...EMPTY_LAYOUT_METRICS };
  let statsSeq = 0;
  const timingEnabled = new URLSearchParams(window.location.search).has("layoutTiming");
  if (timingEnabled) void engine.setTiming(true);

  const publishMetrics = (): void => {
    (window as typeof window & { __VIRITURA_LAYOUT_METRICS__?: LayoutMetrics }).__VIRITURA_LAYOUT_METRICS__ = metrics;
  };

  // Fetch cache stats in the background after a layout so the perf overlay can
  // show them without blocking paint. A monotonic guard keeps the latest win.
  const refreshStats = (): void => {
    const seq = ++statsSeq;
    void Promise.all([
      engine.cacheStats(),
      engine.layoutMetrics(),
      timingEnabled ? engine.takeTimings() : Promise.resolve(null),
    ]).then(([nextStats, nextMetrics, timings]) => {
      if (seq !== statsSeq) return;
      stats = nextStats;
      metrics = nextMetrics;
      publishMetrics();
      if (timings) {
        try {
          (window as typeof window & { __VIRITURA_LAYOUT_TIMINGS__?: unknown }).__VIRITURA_LAYOUT_TIMINGS__ =
            JSON.parse(timings);
        } catch {
          /* malformed optional diagnostics must never affect layout */
        }
      }
    });
  };
  const afterLayout = <T>(dl: T): T => {
    retained = true;
    refreshStats();
    return dl;
  };

  return {
    isWorker: true,
    isReady: () => service.isReady(),
    hasRetainedScore: () => retained,
    cacheStats: () => stats,
    layoutMetrics: () => metrics,
    getScoreInfo: (json) => service.getScoreInfo(json),
    computeMnxScoreLayout: (json, sp, pw, scoreIndex, pageSetupJson) =>
      service.computeMnxScoreLayout(json, sp, pw, scoreIndex, pageSetupJson),
    computeLayout: (json, partIndex, sp, pw, pageSetupJson) =>
      engine.computeLayout(json, partIndex, sp, pw, pageSetupJson).then(afterLayout),
    computeFullScoreLayout: (json, sp, pw, pageSetupJson, scoreIndex) =>
      engine.computeFullScoreLayout(json, sp, pw, pageSetupJson, scoreIndex).then(afterLayout),
    relayoutRetainedScore: (sp, pw, pageSetupJson, scoreIndex) =>
      engine.relayoutRetainedScore(sp, pw, pageSetupJson, scoreIndex),
    applyPatchAndLayout: (patchJson, sp, pw, pageSetupJson, scoreIndex) =>
      engine.applyPatchAndLayout(patchJson, sp, pw, pageSetupJson, scoreIndex).then(afterLayout),
    fullLayout: (json, sp, pw, pageSetupJson, scoreIndex) =>
      engine.fullLayout(json, sp, pw, pageSetupJson, scoreIndex).then(afterLayout),
    invalidateCache: () => {
      retained = false;
      stats = [0, 0];
      metrics = { ...EMPTY_LAYOUT_METRICS };
      publishMetrics();
      void engine.invalidateCache();
    },
    setEmitLayoutDebug: (enabled) => {
      void service.setEmitLayoutDebug(enabled);
    },
    dispose: () => service.dispose(),
  };
}

function makeMainThreadBackend(emitLayoutDebug: boolean): LayoutBackend {
  let engine: CachedLayoutEngine | null = null;
  try {
    engine = createCachedLayoutEngine();
  } catch {
    /* WASM rebuild needed — fall back to stateless functions */
  }
  wasmSetEmitLayoutDebug(emitLayoutDebug);

  // Mirror the worker backend's incremental path on the main thread: the
  // engine ships a tagged patch-frame delta (one fresh system + per-system
  // reuse records) and this reconstructor reassembles the full display list
  // against the retained per-system segments — avoiding a full-DL decode every
  // edit. The reconstructor's held segments must reset exactly when the
  // engine's recorded system order resets (full layout / invalidate); a tagged
  // full frame (`0.0`) also self-resets it. The layout-debug sidecar can't ride
  // the binary frame, so that path stays on the full-DL call.
  let emitDebug = emitLayoutDebug;
  const reconstructor = new PatchReconstructor();

  return {
    isWorker: false,
    isReady: () => isWasmReady(),
    hasRetainedScore: () => engine?.hasRetainedScore() ?? false,
    cacheStats: () => engine?.cacheStats() ?? [0, 0],
    layoutMetrics: () => engine?.layoutMetrics() ?? { ...EMPTY_LAYOUT_METRICS },
    getScoreInfo: (json) => Promise.resolve(wasmGetScoreInfo(json)),
    computeMnxScoreLayout: (json, sp, pw, scoreIndex, pageSetupJson) =>
      Promise.resolve(wasmComputeMnxScoreLayout(json, sp, pw, scoreIndex, pageSetupJson)),
    computeLayout: (json, partIndex, sp, pw, pageSetupJson) => {
      reconstructor.reset();
      return Promise.resolve(
        engine
          ? engine.computeLayout(json, partIndex, sp, pw, pageSetupJson)
          : wasmComputeLayout(json, partIndex, sp, pw, pageSetupJson),
      );
    },
    computeFullScoreLayout: (json, sp, pw, pageSetupJson, scoreIndex) => {
      reconstructor.reset();
      return Promise.resolve(
        engine
          ? engine.computeFullScoreLayout(json, sp, pw, pageSetupJson, scoreIndex)
          : wasmComputeFullScoreLayout(json, sp, pw, pageSetupJson),
      );
    },
    relayoutRetainedScore: (sp, pw, pageSetupJson, scoreIndex) =>
      // Relayout does not reset the engine's recorded system order, so the
      // reconstructor is left intact (a later paged patch re-aligns against it).
      Promise.resolve(engine ? engine.relayoutRetainedScore(sp, pw, pageSetupJson, scoreIndex) : null),
    applyPatchAndLayout: (patchJson, sp, pw, pageSetupJson, scoreIndex) => {
      if (!engine) return Promise.reject(new Error("No retained engine for patch layout"));
      // The debug sidecar never produces patch frames — keep the full-DL path.
      if (emitDebug) {
        return Promise.resolve(engine.applyPatchAndLayout(patchJson, sp, pw, pageSetupJson, scoreIndex));
      }
      try {
        const tagged = engine.applyPatchAndLayoutPatchFrameBinary(patchJson, sp, pw, pageSetupJson, scoreIndex);
        return Promise.resolve(reconstructor.apply(decodeFrame(tagged)));
      } catch (err) {
        // Reconstructor desync (should not happen given the reset invariants).
        // Recover by dropping the cache, resetting, and returning a full DL.
        console.warn("[LayoutBackend] main-thread patch-frame reconstruction failed; full relayout:", err);
        engine.invalidateCache();
        reconstructor.reset();
        return Promise.resolve(engine.applyPatchAndLayout(patchJson, sp, pw, pageSetupJson, scoreIndex));
      }
    },
    fullLayout: (json, sp, pw, pageSetupJson, scoreIndex) => {
      reconstructor.reset();
      return Promise.resolve(
        engine
          ? engine.fullLayout(json, sp, pw, pageSetupJson, scoreIndex)
          : wasmComputeFullScoreLayout(json, sp, pw, pageSetupJson),
      );
    },
    invalidateCache: () => {
      reconstructor.reset();
      engine?.invalidateCache();
    },
    setEmitLayoutDebug: (enabled) => {
      emitDebug = enabled;
      wasmSetEmitLayoutDebug(enabled);
    },
    dispose: () => engine?.dispose(),
  };
}
