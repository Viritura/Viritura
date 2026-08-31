/**
 * Main-thread layout service — owns the layout Web Worker and exposes an async
 * API mirroring the synchronous {@link CachedLayoutEngine} surface.
 *
 * The editor talks to this instead of calling WASM directly, so layout/parse/
 * serialize work happens off the main thread. The worker hosts a single
 * retained-score engine; this wrapper forwards calls through a Comlink proxy.
 *
 * Callers must `await ready` before relying on the engine. When `ready`
 * resolves `false` (WASM failed to load in the worker), callers should fall
 * back to the synchronous main-thread engine.
 */

import * as Comlink from "comlink";
import { resolveBasePath } from "../basePath";
import { decodeBinaryDisplayList } from "../binaryDisplayList";
import { decodeFrame, PatchReconstructor } from "../patchFrame";
import type { DisplayList, ScoreInfo } from "../wasmTypes";
import type { LayoutMetrics } from "../wasm";
import type { LayoutWorkerApi } from "./layoutWorkerApi";

/** Async counterpart of {@link CachedLayoutEngine}. */
export interface AsyncCachedLayoutEngine {
  computeLayout(
    mnxJson: string,
    partIndex: number,
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
  ): Promise<DisplayList>;
  computeFullScoreLayout(
    mnxJson: string,
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<DisplayList>;
  relayoutRetainedScore(
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<DisplayList | null>;
  applyPatchAndLayout(
    patchJson: string,
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<DisplayList>;
  fullLayout(
    mnxJson: string,
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<DisplayList>;
  invalidateCache(): Promise<void>;
  cacheStats(): Promise<[number, number]>;
  layoutMetrics(): Promise<LayoutMetrics>;
  setTiming(enabled: boolean): Promise<void>;
  takeTimings(): Promise<string | null>;
  hasRetainedScore(): Promise<boolean>;
}

export interface LayoutService {
  /** Resolves `true` when the worker's WASM module + engine are ready. */
  readonly ready: Promise<boolean>;
  /** Synchronous snapshot of readiness (false until `ready` resolves true). */
  isReady(): boolean;
  getScoreInfo(mnxJson: string): Promise<ScoreInfo>;
  computeMnxScoreLayout(
    mnxJson: string,
    spatium: number,
    pageWidth?: number,
    scoreIndex?: number,
    pageSetupJson?: string,
  ): Promise<DisplayList>;
  setEmitLayoutDebug(enabled: boolean): Promise<void>;
  readonly engine: AsyncCachedLayoutEngine;
  /** Terminate the worker and release its WASM engine. */
  dispose(): void;
}

/**
 * Create a layout service backed by a dedicated Web Worker.
 *
 * @param emitLayoutDebug - Initial layout-debug sidecar flag for the worker.
 */
export function createLayoutService(emitLayoutDebug = false): LayoutService {
  const worker = new Worker(new URL("./layout.worker.ts", import.meta.url), {
    type: "module",
    name: "viritura-layout",
  });
  const proxy = Comlink.wrap<LayoutWorkerApi>(worker);

  // When the layout-debug sidecar is on, the binary transport can't carry the
  // `layoutDebug` field — fall back to the JSON path so the debug overlay keeps
  // working. Otherwise prefer the zero-copy binary transfer (no structured
  // clone of the deep DisplayList).
  let emitDebug = emitLayoutDebug;

  // Main-thread patch-frame reassembler for the paged incremental path. Holds
  // the previous frame's per-system segments so the worker only ships freshly
  // rendered systems (+ shift records) per edit. Its retained list must reset
  // exactly when the engine's `last_system_order` resets — i.e. on full_layout,
  // invalidate, and every compute* entry that establishes a new retained score.
  // Relayout does NOT reset engine order, so the reconstructor is left intact
  // there and self-heals via the engine's hash-based Fresh fallback. The
  // reconstructor itself also clears on any tagged full frame (`0.0`).
  const reconstructor = new PatchReconstructor();
  const resetReconstructor = (): void => reconstructor.reset();

  let readyResolved = false;
  const ready = (async () => {
    try {
      const ok = await proxy.init(resolveBasePath(), emitLayoutDebug);
      readyResolved = ok;
      return ok;
    } catch (e) {
      console.warn("Layout worker failed to initialize:", e);
      readyResolved = false;
      return false;
    }
  })();

  const engine: AsyncCachedLayoutEngine = {
    computeLayout(mnxJson, partIndex, spatium, pageWidth = 0, pageSetupJson) {
      resetReconstructor();
      return proxy.engineComputeLayout(mnxJson, partIndex, spatium, pageWidth, pageSetupJson);
    },
    computeFullScoreLayout(mnxJson, spatium, pageWidth = 0, pageSetupJson, scoreIndex) {
      resetReconstructor();
      if (emitDebug) {
        return proxy.engineComputeFullScoreLayout(mnxJson, spatium, pageWidth, pageSetupJson, scoreIndex);
      }
      return proxy
        .engineComputeFullScoreLayoutBinary(mnxJson, spatium, pageWidth, pageSetupJson, scoreIndex)
        .then(decodeBinaryDisplayList);
    },
    relayoutRetainedScore(spatium, pageWidth = 0, pageSetupJson, scoreIndex) {
      // Relayout does not reset the engine's recorded system order, so the
      // reconstructor is intentionally left intact; a subsequent paged patch
      // re-aligns against it (or re-seeds via Fresh placements on a width
      // change).
      if (emitDebug) {
        return proxy.engineRelayoutRetainedScore(spatium, pageWidth, pageSetupJson, scoreIndex);
      }
      return proxy
        .engineRelayoutRetainedScoreBinary(spatium, pageWidth, pageSetupJson, scoreIndex)
        .then((binary) => (binary ? decodeBinaryDisplayList(binary) : null));
    },
    async applyPatchAndLayout(patchJson, spatium, pageWidth = 0, pageSetupJson, scoreIndex) {
      // The debug sidecar never produces patch frames, so keep the plain
      // full-binary path there. Both paged AND horizon (pageWidth 0) emit
      // patch frames as of Lever 0 (chunked-horizon retention), so both take
      // the incremental path below.
      if (emitDebug) {
        return proxy.engineApplyPatchAndLayout(patchJson, spatium, pageWidth, pageSetupJson, scoreIndex);
      }

      // Incremental path: the worker ships a tagged patch frame; this thread
      // reassembles it against the retained per-system segments. The frame may
      // come back tagged `full` (the engine couldn't produce a delta this
      // edit — e.g. a structural change); `decodeFrame` handles both and the
      // reconstructor resets itself on a full frame.
      performance.mark("viritura:worker-rpc-start");
      const tagged = await proxy.engineApplyPatchAndLayoutPatchFrameBinary(
        patchJson,
        spatium,
        pageWidth,
        pageSetupJson,
        scoreIndex,
      );
      performance.mark("viritura:worker-rpc-end");
      try {
        performance.measure("viritura:worker-rpc", "viritura:worker-rpc-start", "viritura:worker-rpc-end");
      } catch {
        /* optional performance telemetry */
      }
      try {
        performance.mark("viritura:patch-reconstruct-start");
        const displayList = reconstructor.apply(decodeFrame(tagged), pageWidth === 0);
        performance.mark("viritura:patch-reconstruct-end");
        try {
          performance.measure(
            "viritura:patch-reconstruct",
            "viritura:patch-reconstruct-start",
            "viritura:patch-reconstruct-end",
          );
        } catch {
          /* optional performance telemetry */
        }
        return displayList;
      } catch (err) {
        // Reconstructor desync (should not happen given the engine's order/
        // reconstructor reset invariants). Recover safely: drop the cache so
        // the engine re-seeds an all-Fresh order, reset the reconstructor, and
        // return a full relayout of the already-patched retained model.
        console.warn("Patch-frame reconstruction failed; falling back to full relayout:", err);
        await proxy.engineInvalidateCache();
        resetReconstructor();
        const binary = await proxy.engineRelayoutRetainedScoreBinary(spatium, pageWidth, pageSetupJson, scoreIndex);
        if (!binary) throw err;
        return decodeBinaryDisplayList(binary);
      }
    },
    fullLayout(mnxJson, spatium, pageWidth = 0, pageSetupJson, scoreIndex) {
      resetReconstructor();
      return proxy.engineFullLayout(mnxJson, spatium, pageWidth, pageSetupJson, scoreIndex);
    },
    invalidateCache() {
      resetReconstructor();
      return proxy.engineInvalidateCache();
    },
    cacheStats() {
      return proxy.engineCacheStats();
    },
    layoutMetrics() {
      return proxy.engineLayoutMetrics();
    },
    setTiming(enabled) {
      return proxy.engineSetTiming(enabled);
    },
    takeTimings() {
      return proxy.engineTakeTimings();
    },
    hasRetainedScore() {
      return proxy.engineHasRetainedScore();
    },
  };

  return {
    ready,
    isReady() {
      return readyResolved;
    },
    getScoreInfo(mnxJson) {
      return proxy.getScoreInfo(mnxJson);
    },
    computeMnxScoreLayout(mnxJson, spatium, pageWidth = 0, scoreIndex = 0, pageSetupJson) {
      if (emitDebug) {
        return proxy.computeMnxScoreLayout(mnxJson, spatium, pageWidth, scoreIndex, pageSetupJson);
      }
      return proxy
        .computeMnxScoreLayoutBinary(mnxJson, spatium, pageWidth, scoreIndex, pageSetupJson)
        .then(decodeBinaryDisplayList);
    },
    setEmitLayoutDebug(enabled) {
      emitDebug = enabled;
      return proxy.setEmitLayoutDebug(enabled);
    },
    engine,
    dispose() {
      worker.terminate();
    },
  };
}
