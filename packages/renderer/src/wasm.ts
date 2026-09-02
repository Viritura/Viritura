/**
 * WASM Engine wrapper — loads and initializes the Viritura WASM module.
 *
 * This wraps the wasm-bindgen generated JS glue code and provides
 * a clean TypeScript API for the editor to use.
 */

import { decodeBinaryDisplayList } from "./binaryDisplayList";

// Type re-exports — definitions live in wasmTypes.ts.
export * from "./wasmTypes";
import type { BoundingBox, DisplayList, ScoreInfo, SlurPreview, SlurPreviewInput } from "./wasmTypes";

declare const __VIRITURA_WASM_ASSET_HASH__: string | undefined;

// Module-level state
let wasmModule: {
  compute_layout: (
    mnx_json: string,
    part_index: number,
    spatium: number,
    page_width: number,
    page_setup_json?: string,
  ) => string;
  compute_layout_binary: (
    mnx_json: string,
    part_index: number,
    spatium: number,
    page_width: number,
    page_setup_json?: string,
  ) => Float32Array;
  compute_full_score_layout: (
    mnx_json: string,
    spatium: number,
    page_width: number,
    page_setup_json?: string,
  ) => string;
  compute_full_score_layout_binary: (
    mnx_json: string,
    spatium: number,
    page_width: number,
    page_setup_json?: string,
  ) => Float32Array;
  compute_mnx_score_layout: (
    mnx_json: string,
    spatium: number,
    page_width: number,
    score_index: number,
    page_setup_json?: string,
  ) => string;
  compute_mnx_score_layout_binary: (
    mnx_json: string,
    spatium: number,
    page_width: number,
    score_index: number,
    page_setup_json?: string,
  ) => Float32Array;
  get_score_info: (mnx_json: string) => string;
  engine_version: () => string;
  compute_slur_preview: (preview_json: string) => string;
  export_svg: (
    display_list_json: string,
    bravura_data: Uint8Array,
    text_font_data: Uint8Array,
    spatium_mm: number,
    sp_pixels: number,
    page_width_mm: number,
    page_height_mm: number,
  ) => string;
  set_emit_layout_debug?: (enabled: boolean) => void;
  get_emit_layout_debug?: () => boolean;
  set_wasm_timing?: (enabled: boolean) => void;
} | null = null;

let initPromise: Promise<void> | null = null;

import { resolveBasePath } from "./basePath";

/**
 * Initialize the WASM engine. Must be called before any other function.
 * Safe to call multiple times — only initializes once.
 */
export async function initWasm(): Promise<void> {
  if (wasmModule) return;
  if (initPromise) return initPromise;

  const attempt = (async () => {
    try {
      const basePath = resolveBasePath();
      const assetHash =
        typeof __VIRITURA_WASM_ASSET_HASH__ === "string" && __VIRITURA_WASM_ASSET_HASH__.length > 0
          ? `.${__VIRITURA_WASM_ASSET_HASH__}`
          : "";

      // Step 1: Fetch the WASM binary
      const wasmResponse = await fetch(`${basePath}wasm/viritura_wasm_bg${assetHash}.wasm`);
      if (!wasmResponse.ok) {
        throw new Error(`Failed to fetch WASM binary: ${wasmResponse.status}`);
      }
      const wasmBytes = await wasmResponse.arrayBuffer();

      // Step 2: Import the same-origin generated glue directly. Avoiding a
      // blob: module lets production enforce `script-src 'self'`.
      const glue = await import(/* @vite-ignore */ `${basePath}wasm/viritura_wasm${assetHash}.js`);

      // Step 3: Initialize with the binary bytes (avoids a second WASM fetch).
      const wasmModule_ = new WebAssembly.Module(wasmBytes);
      glue.initSync({ module: wasmModule_ });

      wasmModule = glue;
      _flushPendingDebugFlag();
      console.log(`Viritura WASM engine v${glue.engine_version()} loaded`);
    } catch (e) {
      console.warn("WASM engine failed to load:", e);
      if (e instanceof Error) {
        console.warn("Error details:", e.message);
      }
      wasmModule = null;
    }
  })();
  initPromise = attempt;
  try {
    await attempt;
  } finally {
    // A transient fetch/CSP/cache failure must not poison initialization for
    // the lifetime of this realm. Successful initialization keeps the resolved
    // promise as the idempotent fast path; failure clears it so a later caller
    // can retry.
    if (!wasmModule && initPromise === attempt) initPromise = null;
  }
}

/**
 * Check if the WASM engine is loaded and ready.
 */
export function isWasmReady(): boolean {
  return wasmModule !== null;
}

export function computeSlurPreview(input: SlurPreviewInput): SlurPreview {
  if (!wasmModule) {
    throw new Error("WASM engine not initialized. Call initWasm() first.");
  }
  return JSON.parse(wasmModule.compute_slur_preview(JSON.stringify(input))) as SlurPreview;
}

/**
 * Compute layout using the WASM engine.
 * Returns a DisplayList of render commands.
 * @param pageWidth - Available page width in pixels (0 = no system breaking)
 */
/**
 * Map snake_case keys from Rust JSON to camelCase TypeScript DisplayList.
 * Handles: element_ids → elementIds, element_bboxes → elementBboxes
 */
function normalizeDisplayList(raw: Record<string, unknown>): DisplayList {
  const dl = raw as unknown as DisplayList;
  // Remap snake_case → camelCase if needed
  if (!dl.elementIds && (raw as Record<string, unknown>)["element_ids"]) {
    dl.elementIds = (raw as Record<string, unknown>)["element_ids"] as (string | null)[];
  }
  if (!dl.elementBboxes && (raw as Record<string, unknown>)["element_bboxes"]) {
    const rawBboxes = (raw as Record<string, unknown>)["element_bboxes"] as Record<string, unknown>[];
    dl.elementBboxes = rawBboxes.map((b) => ({
      elementId: (b["elementId"] ?? b["element_id"]) as string,
      bbox: (b["bbox"] ?? b) as BoundingBox,
    }));
  }
  // Normalize measure_bounds → measureBounds
  if (!dl.measureBounds && (raw as Record<string, unknown>)["measure_bounds"]) {
    const rawBounds = (raw as Record<string, unknown>)["measure_bounds"] as Record<string, unknown>[];
    dl.measureBounds = rawBounds.map((b) => ({
      index: b["index"] as number,
      measureId: (b["measureId"] ?? b["measure_id"]) as string | undefined,
      partIndex: (b["partIndex"] ?? b["part_index"]) as number,
      staffIndex: (b["staffIndex"] ?? b["staff_index"] ?? b["partIndex"] ?? b["part_index"]) as number,
      systemIndex: (b["systemIndex"] ?? b["system_index"]) as number | undefined,
      x: b["x"] as number,
      width: b["width"] as number,
      y: b["y"] as number,
      height: b["height"] as number,
      prefixWidth: (b["prefixWidth"] ?? b["prefix_width"]) as number,
      totalBeats: (b["totalBeats"] ?? b["total_beats"]) as number,
      beatAnchors: (b["beatAnchors"] ?? b["beat_anchors"]) as [number, number][],
      ghostStaff: (b["ghostStaff"] ?? b["ghost_staff"]) as boolean | undefined,
      isHidden: (b["isHidden"] ?? b["is_hidden"]) as boolean | undefined,
      hasMusicHidden: (b["hasMusicHidden"] ?? b["has_music_hidden"]) as boolean | undefined,
      isExpansion: (b["isExpansion"] ?? b["is_expansion"]) as boolean | undefined,
    }));
  }
  // Normalize layout_debug → layoutDebug
  if (!dl.layoutDebug && (raw as Record<string, unknown>)["layout_debug"]) {
    dl.layoutDebug = (raw as Record<string, unknown>)["layout_debug"] as DisplayList["layoutDebug"];
  }
  // Normalize slur_geometries → slurGeometries
  if (!dl.slurGeometries && (raw as Record<string, unknown>)["slur_geometries"]) {
    const rawSlurs = (raw as Record<string, unknown>)["slur_geometries"] as Record<string, unknown>[];
    dl.slurGeometries = rawSlurs.map((s) => ({
      elementId: (s["elementId"] ?? s["element_id"]) as string,
      p0x: (s["p0x"] ?? s["p0_x"]) as number,
      p0y: (s["p0y"] ?? s["p0_y"]) as number,
      p1x: (s["p1x"] ?? s["p1_x"]) as number,
      p1y: (s["p1y"] ?? s["p1_y"]) as number,
      p2x: (s["p2x"] ?? s["p2_x"]) as number,
      p2y: (s["p2y"] ?? s["p2_y"]) as number,
      p3x: (s["p3x"] ?? s["p3_x"]) as number,
      p3y: (s["p3y"] ?? s["p3_y"]) as number,
      thickness: s["thickness"] as number,
      curveDir: (s["curveDir"] ?? s["curve_dir"]) as number,
      sp: s["sp"] as number,
    }));
  }
  // Normalize page_turn_warnings → pageTurnWarnings
  if (!dl.pageTurnWarnings && (raw as Record<string, unknown>)["page_turn_warnings"]) {
    const rawWarnings = (raw as Record<string, unknown>)["page_turn_warnings"] as Record<string, unknown>[];
    dl.pageTurnWarnings = rawWarnings.map((w) => ({
      boundaryMeasure: (w["boundaryMeasure"] ?? w["boundary_measure"]) as number,
      kind: w["kind"] as string,
      turnSeconds: (w["turnSeconds"] ?? w["turn_seconds"]) as number,
    }));
  }
  return dl;
}

export function computeLayout(
  mnxJson: string,
  partIndex: number,
  spatium: number,
  pageWidth: number = 0,
  pageSetupJson?: string,
): DisplayList {
  if (!wasmModule) {
    throw new Error("WASM engine not initialized. Call initWasm() first.");
  }
  const resultJson = wasmModule.compute_layout(mnxJson, partIndex, spatium, pageWidth, pageSetupJson);
  return normalizeDisplayList(JSON.parse(resultJson));
}

/**
 * Compute layout for all parts stacked vertically using the WASM engine.
 * Returns a DisplayList of render commands for the full score.
 * @param pageWidth - Available page width in pixels (0 = no system breaking)
 */
export function computeFullScoreLayout(
  mnxJson: string,
  spatium: number,
  pageWidth: number = 0,
  pageSetupJson?: string,
): DisplayList {
  if (!wasmModule) {
    throw new Error("WASM engine not initialized. Call initWasm() first.");
  }
  const resultJson = wasmModule.compute_full_score_layout(mnxJson, spatium, pageWidth, pageSetupJson);
  return normalizeDisplayList(JSON.parse(resultJson));
}

/**
 * Compute layout using the WASM engine, returning binary Float32Array.
 * Significantly faster than JSON for large scores (>50 measures).
 * @param pageWidth - Available page width in pixels (0 = no system breaking)
 */
export function computeLayoutBinary(
  mnxJson: string,
  partIndex: number,
  spatium: number,
  pageWidth: number = 0,
  pageSetupJson?: string,
): Float32Array {
  if (!wasmModule) {
    throw new Error("WASM engine not initialized. Call initWasm() first.");
  }
  return wasmModule.compute_layout_binary(mnxJson, partIndex, spatium, pageWidth, pageSetupJson);
}

/**
 * Compute layout for all parts using the WASM engine, returning binary Float32Array.
 * Significantly faster than JSON for large scores (>50 measures).
 * @param pageWidth - Available page width in pixels (0 = no system breaking)
 */
export function computeFullScoreLayoutBinary(
  mnxJson: string,
  spatium: number,
  pageWidth: number = 0,
  pageSetupJson?: string,
): Float32Array {
  if (!wasmModule) {
    throw new Error("WASM engine not initialized. Call initWasm() first.");
  }
  return wasmModule.compute_full_score_layout_binary(mnxJson, spatium, pageWidth, pageSetupJson);
}

/**
 * Compute layout using a specific MNX score definition index.
 * Returns a DisplayList of render commands.
 * @param scoreIndex - Index into the MNX scores[] array
 */
export function computeMnxScoreLayout(
  mnxJson: string,
  spatium: number,
  pageWidth: number = 0,
  scoreIndex: number = 0,
  pageSetupJson?: string,
): DisplayList {
  if (!wasmModule) {
    throw new Error("WASM engine not initialized. Call initWasm() first.");
  }
  const resultJson = wasmModule.compute_mnx_score_layout(mnxJson, spatium, pageWidth, scoreIndex, pageSetupJson);
  return normalizeDisplayList(JSON.parse(resultJson));
}

/**
 * Binary sibling of {@link computeMnxScoreLayout}: returns the raw packed
 * Float32Array (no decode) so a worker host can `transfer` it to the main
 * thread zero-copy instead of structured-cloning a deep DisplayList.
 * @param scoreIndex - Index into the MNX scores[] array
 */
export function computeMnxScoreLayoutBinary(
  mnxJson: string,
  spatium: number,
  pageWidth: number = 0,
  scoreIndex: number = 0,
  pageSetupJson?: string,
): Float32Array {
  if (!wasmModule) {
    throw new Error("WASM engine not initialized. Call initWasm() first.");
  }
  return wasmModule.compute_mnx_score_layout_binary(mnxJson, spatium, pageWidth, scoreIndex, pageSetupJson);
}

/**
 * Get score metadata from MNX JSON.
 */
export function getScoreInfo(mnxJson: string): ScoreInfo {
  if (!wasmModule) {
    throw new Error("WASM engine not initialized. Call initWasm() first.");
  }
  const resultJson = wasmModule.get_score_info(mnxJson);
  return JSON.parse(resultJson) as ScoreInfo;
}

/**
 * Toggle the layout-debug sidecar. When enabled, every subsequent layout
 * call emits a `layoutDebug` field on the returned `DisplayList`. Used by
 * the editor's spacing debug overlay.
 *
 * Safe to call before `initWasm()` resolves — the value is replayed onto
 * the module once it's ready.
 */
let pendingDebugFlag: boolean | null = null;
export function setEmitLayoutDebug(enabled: boolean): void {
  if (!wasmModule) {
    pendingDebugFlag = enabled;
    return;
  }
  if (typeof wasmModule.set_emit_layout_debug === "function") {
    wasmModule.set_emit_layout_debug(enabled);
  }
}

/** Internal — called from initWasm once the module is ready. */
function _flushPendingDebugFlag(): void {
  if (pendingDebugFlag !== null && wasmModule?.set_emit_layout_debug) {
    wasmModule.set_emit_layout_debug(pendingDebugFlag);
    pendingDebugFlag = null;
  }
}

export function getEmitLayoutDebug(): boolean {
  return Boolean(wasmModule?.get_emit_layout_debug?.());
}

/** Per-page SVG result from WASM export. */
export interface WasmSvgPage {
  pageNumber: number;
  svg: string;
  widthMm: number;
  heightMm: number;
}

/**
 * Export a DisplayList to per-page SVG strings via the WASM engine.
 *
 * All music glyphs and text are expanded to vector path outlines using
 * font data, producing self-contained SVGs with no external dependencies.
 *
 * @param displayListJson - Serialised DisplayList (from any compute_* function).
 * @param bravuraData - Raw bytes of Bravura.otf (SMuFL music font).
 * @param textFontData - Raw bytes of a text font (e.g. BravuraText.otf). Pass empty for fallback.
 * @returns Array of per-page SVG results.
 */
export function wasmExportSvg(
  displayListJson: string,
  bravuraData: Uint8Array,
  textFontData: Uint8Array,
  spatiumMm: number,
  spPixels: number,
  pageWidthMm: number,
  pageHeightMm: number,
): WasmSvgPage[] {
  if (!wasmModule) {
    throw new Error("WASM engine not initialized. Call initWasm() first.");
  }
  const resultJson = wasmModule.export_svg(
    displayListJson,
    bravuraData,
    textFontData,
    spatiumMm,
    spPixels,
    pageWidthMm,
    pageHeightMm,
  );
  return JSON.parse(resultJson) as WasmSvgPage[];
}

// ═══════════════════════════════════════════
// Stateful cached layout engine
// ═══════════════════════════════════════════

/** Opaque handle to a WASM LayoutEngine instance with measure-level cache. */
interface WasmLayoutEngine {
  compute_layout_cached(
    mnx_json: string,
    part_index: number,
    spatium: number,
    page_width: number,
    page_setup_json?: string,
  ): string;
  compute_full_score_layout_cached(
    mnx_json: string,
    spatium: number,
    page_width: number,
    page_setup_json?: string,
    score_index?: number,
  ): string;
  compute_full_score_layout_cached_binary(
    mnx_json: string,
    spatium: number,
    page_width: number,
    page_setup_json?: string,
    score_index?: number,
  ): Float32Array;
  relayout_retained_score_cached(
    spatium: number,
    page_width: number,
    page_setup_json?: string,
    score_index?: number,
  ): string;
  relayout_retained_score_cached_binary(
    spatium: number,
    page_width: number,
    page_setup_json?: string,
    score_index?: number,
  ): Float32Array;
  apply_patch_and_layout(
    patch_json: string,
    spatium: number,
    page_width: number,
    page_setup_json?: string,
    score_index?: number,
  ): string;
  apply_patch_and_layout_binary(
    patch_json: string,
    spatium: number,
    page_width: number,
    page_setup_json?: string,
    score_index?: number,
  ): Float32Array;
  apply_patch_and_layout_patch_frame_binary(
    patch_json: string,
    spatium: number,
    page_width: number,
    page_setup_json?: string,
    score_index?: number,
  ): Float32Array;
  full_layout(
    mnx_json: string,
    spatium: number,
    page_width: number,
    page_setup_json?: string,
    score_index?: number,
  ): string;
  invalidate_cache(): void;
  cache_stats(): number[];
  layout_metrics_json(): string;
  take_timings_json(): string | undefined;
  has_retained_score(): boolean;
  /**
   * Lever 2 step 4 (B-full): enable the per-system wholesale layout-reuse
   * store. Off by default in the engine; the factory opts in. Byte-identical
   * to the per-measure path (proven by the engine oracle).
   */
  set_system_layout_reuse?(enabled: boolean): void;
  free(): void;
}

/** Enable detailed engine phase timings in this realm's WASM instance. */
export function setWasmTiming(enabled: boolean): void {
  wasmModule?.set_wasm_timing?.(enabled);
}

/** Deterministic counters from the most recent retained-engine layout pass. */
export interface LayoutMetrics {
  resolvedCells: number;
  resolvedFullCells: number;
  widthCells: number;
  widthFullCells: number;
  freshSystems: number;
  reusedSystems: number;
  staffContentReuses: number;
  staffContentReuseRuns: number;
  staffAuxReuses: number;
  systemMeasureReuses: number;
  spannerBoundsFull: number;
  spannerBounds: number;
  mmrPlanReused: boolean;
  frameBytes: number;
  patchFrame: boolean;
  horizonChunksReused: boolean;
  horizonStaffExtentsReused: number;
  horizonTieMapsReused: number;
  cacheHits: number;
  cacheMisses: number;
}

export const EMPTY_LAYOUT_METRICS: LayoutMetrics = {
  resolvedCells: 0,
  resolvedFullCells: 0,
  widthCells: 0,
  widthFullCells: 0,
  freshSystems: 0,
  reusedSystems: 0,
  staffContentReuses: 0,
  staffContentReuseRuns: 0,
  staffAuxReuses: 0,
  systemMeasureReuses: 0,
  spannerBoundsFull: 0,
  spannerBounds: 0,
  mmrPlanReused: false,
  frameBytes: 0,
  patchFrame: false,
  horizonChunksReused: false,
  horizonStaffExtentsReused: 0,
  horizonTieMapsReused: 0,
  cacheHits: 0,
  cacheMisses: 0,
};

/**
 * Stateful layout engine with measure-level cache.
 * Reuses natural width computations for unchanged measures across re-layouts.
 *
 * Usage:
 * ```ts
 * const engine = createCachedLayoutEngine();
 * const dl1 = engine.computeLayout(mnx, 0, sp, pw);   // full computation
 * const dl2 = engine.computeLayout(mnx2, 0, sp, pw);  // only changed measures recomputed
 * engine.dispose();
 * ```
 */
export interface CachedLayoutEngine {
  computeLayout(
    mnxJson: string,
    partIndex: number,
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
  ): DisplayList;
  computeFullScoreLayout(
    mnxJson: string,
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): DisplayList;
  /** Binary sibling of {@link computeFullScoreLayout}: returns the raw packed
   *  Float32Array (no decode) so a worker host can `transfer` it zero-copy,
   *  avoiding a multi-megabyte JSON serialize + clone + parse on initial load. */
  computeFullScoreLayoutBinary(
    mnxJson: string,
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Float32Array;
  /** Re-layout the already-retained Score for a different score view / config
   *  WITHOUT re-parsing MNX JSON. Requires a prior full layout call; returns
   *  null when no score is retained so the caller can fall back. */
  relayoutRetainedScore(
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): DisplayList | null;
  /** Binary sibling of {@link relayoutRetainedScore}: returns the raw packed
   *  Float32Array (no decode) so a worker host can `transfer` it zero-copy.
   *  Returns null when no score is retained. */
  relayoutRetainedScoreBinary(
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Float32Array | null;
  /** Apply a measure-level patch and re-layout incrementally.
   *  Only changed measures are re-parsed. Requires a prior full layout call. */
  applyPatchAndLayout(
    patchJson: string,
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): DisplayList;
  /** Binary sibling of {@link applyPatchAndLayout}: returns the raw packed
   *  Float32Array (no decode) for zero-copy worker transfer. */
  applyPatchAndLayoutBinary(
    patchJson: string,
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Float32Array;
  /** Incremental sibling of {@link applyPatchAndLayoutBinary} that returns a
   *  PATCH-FRAME delta (tagged at element 0: `0.0` = full display list, `1.0` =
   *  patch frame) instead of a full display list, when the paged auto-flow path
   *  can produce one. The caller reassembles it against a retained per-system
   *  segment list (see `PatchReconstructor`). Falls back to a tagged full frame
   *  transparently for every other layout path. */
  applyPatchAndLayoutPatchFrameBinary(
    patchJson: string,
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): Float32Array;
  /** Full parse + layout with cache invalidation (for structural changes). */
  fullLayout(
    mnxJson: string,
    spatium: number,
    pageWidth?: number,
    pageSetupJson?: string,
    scoreIndex?: number,
  ): DisplayList;
  invalidateCache(): void;
  /** Returns [hits, misses] from the last layout pass. */
  cacheStats(): [number, number];
  /** Deterministic work/transport counters from the last layout pass. */
  layoutMetrics(): LayoutMetrics;
  /** Drain the optional detailed phase timing JSON for the last patch. */
  takeTimings(): string | null;
  /** True if the engine has a retained Score (patch API available). */
  hasRetainedScore(): boolean;
  dispose(): void;
}

/**
 * Create a stateful cached layout engine.
 * Must call initWasm() first.
 */
export function createCachedLayoutEngine(): CachedLayoutEngine {
  if (!wasmModule) {
    throw new Error("WASM engine not initialized. Call initWasm() first.");
  }

  // The LayoutEngine constructor is exposed via wasm_bindgen
  const EngineClass = (wasmModule as Record<string, unknown>)["LayoutEngine"] as {
    new (): WasmLayoutEngine;
  };
  if (!EngineClass) {
    throw new Error("LayoutEngine not found in WASM module. Rebuild WASM.");
  }
  const engine = new EngineClass();

  // Lever 2 step 4 (B-full): opt into the per-system wholesale layout-reuse
  // store. Byte-identical to the per-measure path (engine oracle), and ~18ms
  // faster per warm edit on large paged scores. Guarded with `?.` so an older
  // WASM build without the setter still loads.
  engine.set_system_layout_reuse?.(true);

  return {
    computeLayout(mnxJson, partIndex, spatium, pageWidth = 0, pageSetupJson?) {
      const resultJson = engine.compute_layout_cached(mnxJson, partIndex, spatium, pageWidth, pageSetupJson);
      return normalizeDisplayList(JSON.parse(resultJson));
    },
    computeFullScoreLayout(mnxJson, spatium, pageWidth = 0, pageSetupJson?, scoreIndex?) {
      const resultJson = engine.compute_full_score_layout_cached(
        mnxJson,
        spatium,
        pageWidth,
        pageSetupJson,
        scoreIndex,
      );
      return normalizeDisplayList(JSON.parse(resultJson));
    },
    computeFullScoreLayoutBinary(mnxJson, spatium, pageWidth = 0, pageSetupJson?, scoreIndex?) {
      return engine.compute_full_score_layout_cached_binary(mnxJson, spatium, pageWidth, pageSetupJson, scoreIndex);
    },
    relayoutRetainedScore(spatium, pageWidth = 0, pageSetupJson?, scoreIndex?) {
      if (!engine.has_retained_score()) return null;
      const resultJson = engine.relayout_retained_score_cached(spatium, pageWidth, pageSetupJson, scoreIndex);
      return normalizeDisplayList(JSON.parse(resultJson));
    },
    relayoutRetainedScoreBinary(spatium, pageWidth = 0, pageSetupJson?, scoreIndex?) {
      if (!engine.has_retained_score()) return null;
      return engine.relayout_retained_score_cached_binary(spatium, pageWidth, pageSetupJson, scoreIndex);
    },
    applyPatchAndLayout(patchJson, spatium, pageWidth = 0, pageSetupJson?, scoreIndex?) {
      performance.mark("viritura:wasm-raw-start");
      const binary = engine.apply_patch_and_layout_binary(patchJson, spatium, pageWidth, pageSetupJson, scoreIndex);
      performance.mark("viritura:wasm-raw-end");
      performance.measure("viritura:wasm-raw", "viritura:wasm-raw-start", "viritura:wasm-raw-end");

      performance.mark("viritura:displaylist-parse-start");
      const normalized = decodeBinaryDisplayList(binary);
      performance.mark("viritura:displaylist-parse-end");
      performance.measure(
        "viritura:displaylist-parse",
        "viritura:displaylist-parse-start",
        "viritura:displaylist-parse-end",
      );
      return normalized;
    },
    applyPatchAndLayoutBinary(patchJson, spatium, pageWidth = 0, pageSetupJson?, scoreIndex?) {
      return engine.apply_patch_and_layout_binary(patchJson, spatium, pageWidth, pageSetupJson, scoreIndex);
    },
    applyPatchAndLayoutPatchFrameBinary(patchJson, spatium, pageWidth = 0, pageSetupJson?, scoreIndex?) {
      return engine.apply_patch_and_layout_patch_frame_binary(patchJson, spatium, pageWidth, pageSetupJson, scoreIndex);
    },
    fullLayout(mnxJson, spatium, pageWidth = 0, pageSetupJson?, scoreIndex?) {
      const resultJson = engine.full_layout(mnxJson, spatium, pageWidth, pageSetupJson, scoreIndex);
      return normalizeDisplayList(JSON.parse(resultJson));
    },
    invalidateCache() {
      engine.invalidate_cache();
    },
    cacheStats(): [number, number] {
      const stats = engine.cache_stats();
      return [stats[0] ?? 0, stats[1] ?? 0];
    },
    layoutMetrics(): LayoutMetrics {
      try {
        return JSON.parse(engine.layout_metrics_json()) as LayoutMetrics;
      } catch {
        return { ...EMPTY_LAYOUT_METRICS };
      }
    },
    takeTimings(): string | null {
      return engine.take_timings_json() ?? null;
    },
    hasRetainedScore() {
      return engine.has_retained_score();
    },
    dispose() {
      engine.free();
    },
  };
}
