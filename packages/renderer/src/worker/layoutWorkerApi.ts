/**
 * Shared RPC contract for the layout Web Worker.
 *
 * The worker hosts the WASM module and a single stateful
 * {@link CachedLayoutEngine} instance, so the heavy layout/parse/serialize
 * work runs off the main thread. Both sides import this interface to stay in
 * sync; the worker `expose()`s an implementation and the main-thread service
 * `wrap()`s it via Comlink.
 *
 * Every retained-engine method is explicitly async because the worker
 * serializes access to its single wasm-bindgen object.
 */

import type { DisplayList, ScoreInfo } from "../wasmTypes";
import type { LayoutMetrics } from "../wasm";

export interface LayoutWorkerApi {
  /**
   * Initialize the worker's WASM module and create the retained-score engine.
   *
   * `basePath` must be resolved on the main thread (the worker has no
   * `document`/`<base>` to read) and forwarded here so asset fetches resolve
   * against the correct origin path.
   *
   * Returns `true` when the WASM module loaded and the engine was created.
   */
  init(basePath: string | null, emitLayoutDebug: boolean): Promise<boolean>;

  /** True once {@link init} has successfully loaded WASM + engine. */
  isReady(): boolean;

  /** Toggle the layout-debug sidecar on subsequent layouts. */
  setEmitLayoutDebug(enabled: boolean): void;

  // ── Stateless helpers ────────────────────────────────────────────────
  getScoreInfo(mnxJson: string): ScoreInfo;
  computeMnxScoreLayout(
    mnxJson: string,
    spatium: number,
    pageWidth: number,
    scoreIndex: number,
    pageSetupJson?: string,
  ): DisplayList;
  /**
   * Binary sibling of {@link computeMnxScoreLayout}. Returns the raw packed
   * Float32Array `transfer`-ed zero-copy; the main-thread service decodes it.
   */
  computeMnxScoreLayoutBinary(
    mnxJson: string,
    spatium: number,
    pageWidth: number,
    scoreIndex: number,
    pageSetupJson?: string,
  ): Float32Array;

  // ── Retained-score engine ops ────────────────────────────────────────
  engineComputeLayout(
    mnxJson: string,
    partIndex: number,
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
  ): Promise<DisplayList>;
  engineComputeFullScoreLayout(
    mnxJson: string,
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<DisplayList>;
  /**
   * Binary sibling of {@link engineComputeFullScoreLayout}. Returns the raw
   * packed Float32Array `transfer`-ed zero-copy; the main-thread service
   * decodes it. Avoids a multi-megabyte JSON serialize + structured-clone +
   * `JSON.parse` of the full display list on initial load of large scores.
   */
  engineComputeFullScoreLayoutBinary(
    mnxJson: string,
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<Float32Array>;
  /** Re-layout the retained Score without re-parsing. `null` when none retained. */
  engineRelayoutRetainedScore(
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<DisplayList | null>;
  /**
   * Binary sibling of {@link engineRelayoutRetainedScore}. Returns the raw
   * packed Float32Array `transfer`-ed zero-copy (null when none retained).
   */
  engineRelayoutRetainedScoreBinary(
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<Float32Array | null>;
  /** Incremental patch + layout (typing hot path). Decodes binary in-worker. */
  engineApplyPatchAndLayout(
    patchJson: string,
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<DisplayList>;
  /**
   * Binary sibling of {@link engineApplyPatchAndLayout}. Returns the raw packed
   * Float32Array `transfer`-ed zero-copy; the main-thread service decodes it.
   */
  engineApplyPatchAndLayoutBinary(
    patchJson: string,
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<Float32Array>;
  /**
   * Incremental sibling of {@link engineApplyPatchAndLayoutBinary} returning a
   * tagged PATCH-FRAME delta (`0.0` = full, `1.0` = patch). `transfer`-ed
   * zero-copy; the main-thread service decodes + reassembles it against a
   * retained per-system segment list.
   */
  engineApplyPatchAndLayoutPatchFrameBinary(
    patchJson: string,
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<Float32Array>;
  /** Full parse + layout with cache invalidation (structural changes). */
  engineFullLayout(
    mnxJson: string,
    spatium: number,
    pageWidth: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Promise<DisplayList>;
  engineInvalidateCache(): Promise<void>;
  engineCacheStats(): Promise<[number, number]>;
  engineLayoutMetrics(): Promise<LayoutMetrics>;
  engineSetTiming(enabled: boolean): Promise<void>;
  engineTakeTimings(): Promise<string | null>;
  engineHasRetainedScore(): Promise<boolean>;
}
