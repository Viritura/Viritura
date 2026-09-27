/**
 * `loadEngine()` and the `Engine` handle it resolves to.
 *
 * The engine is the rendering kernel: MNX in, layout + ink + geometry +
 * timeline out. It never touches the DOM beyond the canvas context it is
 * given; page presentation, zoom, scrolling and UI live in the viewer layer.
 */

import {
  getEngineVersion,
  getScoreInfo,
  getWasmInitError,
  initWasm,
  isWasmReady,
  loadMusicFont,
  resolveBasePath,
  setAssetBasePath,
  wasmComputeMnxScoreLayout,
} from "@viritura/renderer";
import { buildCommit, bundledAssetBase, PACKAGE_VERSION } from "./buildInfo";
import { unwrapDisplayList, wrapDisplayList } from "./displayListHandle";
import { EngineLoadError, ParseError } from "./errors";
import {
  canvasToBeat,
  horizonPaper,
  measureGeometry,
  measureLayout,
  playheadAt,
  positionToCanvas,
  systemGeometry,
} from "./geometry";
import { layoutArgs, layoutFailure, messageOf, mnxJson } from "./layoutRequest";
import { createLayoutWorker } from "./layoutWorkerClient";
import { paintInk } from "./paint";
import { exportPageSvg } from "./svgExport";
import { createTileRenderer } from "./tileRenderer";
import type { Timeline, TimelineOptions } from "./timeline";
import { buildTimeline } from "./timelineBuilder";
import type {
  CanvasBeatHit,
  CanvasBeatPosition,
  DisplayList,
  EngineVersion,
  HorizonPaper,
  LayoutOptions,
  LayoutWorker,
  LayoutWorkerOptions,
  LoadEngineOptions,
  MeasureGeometry,
  PaintOptions,
  PlayheadGeometry,
  ScoreInfo,
  ScoreMeasurements,
  ScorePosition,
  SvgOptions,
  SystemGeometry,
  TileRenderer,
} from "./types";

/** The loaded score engine. Acquire via {@link loadEngine}. */
export interface Engine {
  readonly version: EngineVersion;

  /**
   * Lay out an MNX document. Throws `ParseError` for unreadable input and
   * `LayoutError` if the engine fails.
   */
  layout(mnx: string | object, opts: LayoutOptions): DisplayList;

  /**
   * Paint one page's ink into `ctx` under the caller's current transform.
   * Never clears the canvas or paints paper unless `opts.background` is set.
   */
  paint(ctx: CanvasRenderingContext2D, displayList: DisplayList, opts?: PaintOptions): void;

  /** Page sizes and parts of a layout. */
  measure(displayList: DisplayList): ScoreMeasurements;
  /** Systems in reading order, page-local. */
  systems(displayList: DisplayList): SystemGeometry[];
  /** Every rendered measure/staff, page-local. */
  measures(displayList: DisplayList): MeasureGeometry[];
  /** Paper rectangle for unpaged (horizon) layouts. */
  horizonPaper(displayList: DisplayList): HorizonPaper;

  /** Where a musical position lands on its part's (top) staff. */
  positionToCanvas(displayList: DisplayList, position: ScorePosition): CanvasBeatPosition | null;
  /** A cursor spanning the whole system at a musical position. */
  playhead(displayList: DisplayList, position: ScorePosition): PlayheadGeometry | null;
  /** Hit-test a page-local point to a musical position. */
  canvasToBeat(displayList: DisplayList, page: number, x: number, y: number): CanvasBeatHit | null;

  /** Parts, measure count and score entries, without running layout. */
  info(mnx: string | object): ScoreInfo;
  /** Layout-independent playback timeline. Deterministic. */
  timeline(mnx: string | object, opts?: TimelineOptions): Timeline;
  /** Standalone SVG for one page (fonts converted to outlines). */
  toSvg(displayList: DisplayList, opts?: SvgOptions): Promise<string>;

  /** Run layout in a dedicated worker. */
  createLayoutWorker(opts?: LayoutWorkerOptions): LayoutWorker;
  /** Cached tile painter for large unpaged layouts. */
  createTileRenderer(): TileRenderer;
}

let enginePromise: Promise<Engine> | null = null;
let loadedEngine: Engine | null = null;

/**
 * Load the WASM engine and (by default) its fonts. Concurrent calls share one
 * load; a failed load rejects with `EngineLoadError` and may be retried.
 */
export function loadEngine(opts: LoadEngineOptions = {}): Promise<Engine> {
  const base = opts.assetBaseUrl ?? bundledAssetBase();
  if (base) setAssetBasePath(base);
  if (enginePromise) return enginePromise;
  const attempt = loadOnce(opts.textFont !== false).then(
    (engine) => {
      loadedEngine = engine;
      return engine;
    },
    (err: unknown) => {
      if (enginePromise === attempt) enginePromise = null;
      throw err;
    },
  );
  enginePromise = attempt;
  return attempt;
}

/** True once {@link loadEngine} has resolved. */
export function isEngineReady(): boolean {
  return loadedEngine !== null;
}

async function loadOnce(textFont: boolean): Promise<Engine> {
  await initWasm();
  if (!isWasmReady()) {
    const cause = getWasmInitError();
    throw new EngineLoadError(
      `Failed to initialize WASM engine: ${messageOf(cause ?? "unknown error")}`,
      "wasm",
      cause,
    );
  }
  let failed: readonly string[];
  try {
    ({ failed } = await loadMusicFont({ textFont }));
  } catch (err) {
    throw new EngineLoadError(`Failed to load fonts: ${messageOf(err)}`, "font", err);
  }
  if (failed.includes("Bravura")) {
    throw new EngineLoadError("Failed to load the Bravura music font", "font");
  }
  return createEngine();
}

function absoluteAssetBase(): string {
  const base = resolveBasePath();
  if (typeof document === "undefined") return base;
  return new URL(base, document.baseURI).href;
}

/** Build the engine facade. Requires WASM only for layout, info and SVG. */
export function createEngine(): Engine {
  const version: EngineVersion = {
    engine: getEngineVersion() ?? "unknown",
    package: PACKAGE_VERSION,
    commit: buildCommit(),
  };

  return {
    version,

    layout(mnx, opts) {
      const args = layoutArgs(mnx, opts);
      try {
        return wrapDisplayList(
          wasmComputeMnxScoreLayout(args.json, args.spatium, args.pageWidth, args.scoreIndex, args.pageSetupJson),
        );
      } catch (err) {
        throw layoutFailure(err);
      }
    },

    paint(ctx, displayList, opts = {}) {
      paintInk(ctx, unwrapDisplayList(displayList), opts);
    },

    measure: (displayList) => measureLayout(unwrapDisplayList(displayList)),
    systems: (displayList) => systemGeometry(unwrapDisplayList(displayList)),
    measures: (displayList) => measureGeometry(unwrapDisplayList(displayList)),
    horizonPaper: (displayList) => horizonPaper(unwrapDisplayList(displayList)),
    positionToCanvas: (displayList, position) => positionToCanvas(unwrapDisplayList(displayList), position),
    playhead: (displayList, position) => playheadAt(unwrapDisplayList(displayList), position),
    canvasToBeat: (displayList, page, x, y) => canvasToBeat(unwrapDisplayList(displayList), page, x, y),

    info(mnx) {
      const json = mnxJson(mnx);
      try {
        const raw = getScoreInfo(json);
        return {
          parts: raw.partIds.map((id, index) => ({ id, index, name: raw.partNames[index] ?? "" })),
          measureCount: raw.measureCount,
          scores: raw.scoreNames.map((name, index) => ({ index, name })),
        };
      } catch (err) {
        throw new ParseError(`Failed to read score info: ${messageOf(err)}`, "schema", err);
      }
    },

    timeline(mnx, opts = {}) {
      try {
        return buildTimeline(mnx, opts);
      } catch (err) {
        if (err instanceof ParseError) throw err;
        throw new ParseError(`Failed to build timeline: ${messageOf(err)}`, "schema", err);
      }
    },

    toSvg(displayList, opts = {}) {
      return exportPageSvg(unwrapDisplayList(displayList), absoluteAssetBase(), opts);
    },

    createLayoutWorker: (opts) => createLayoutWorker(absoluteAssetBase(), opts),
    createTileRenderer,
  };
}
