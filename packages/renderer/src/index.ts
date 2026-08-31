/**
 * @viritura/renderer — Canvas 2D score renderer.
 */

export { ScoreRenderer } from "./ScoreRenderer";
export { renderScore } from "./renderScore";
export { paintDisplayList, paintCommand, loadMusicFont } from "./displayListPainter";
export {
  decodeBinaryDisplayList,
  paintBinaryDisplayList,
  getBinaryDisplayListDimensions,
  getBinaryDisplayListPages,
  getBinaryDisplayListBboxes,
} from "./binaryDisplayList";
export { decodeFrame, decodePatchFrame, PatchReconstructor } from "./patchFrame";
export type { DecodedFrame, PatchFrame, Placement } from "./patchFrame";
export { GlyphAtlas, COMMON_GLYPHS } from "./glyphAtlas";
export type { GlyphAtlasConfig } from "./glyphAtlas";
export { PageCache, splitCommandsByPage } from "./pageCache";
export {
  SpatialIndex,
  buildHitRegions,
  hitTest,
  paintSelectionOverlay,
  paintMeasureSelectionOverlay,
  paintHitboxDebug,
  getElementType,
  hitTestSpannerHandle,
  paintSpannerDragPreview,
} from "./hitTest";
export type {
  HitRegion,
  LegacyHitTestResult,
  ElementBBox,
  ScoreElementType,
  SpannerHandleHit,
  SpannerHandleEnd,
  DragSnapPoint,
} from "./hitTest";
export { paintBeatRuler } from "./beatRuler";
export type { RulerTick, RulerConfig } from "./beatRuler";
export {
  initWasm,
  isWasmReady,
  computeLayout as wasmComputeLayout,
  computeFullScoreLayout as wasmComputeFullScoreLayout,
  computeLayoutBinary as wasmComputeLayoutBinary,
  computeFullScoreLayoutBinary as wasmComputeFullScoreLayoutBinary,
  computeMnxScoreLayout as wasmComputeMnxScoreLayout,
  computeSlurPreview as wasmComputeSlurPreview,
  getScoreInfo,
  wasmExportSvg,
  createCachedLayoutEngine,
  setEmitLayoutDebug,
  getEmitLayoutDebug,
  EMPTY_LAYOUT_METRICS,
  setWasmTiming,
} from "./wasm";
export { createLayoutService } from "./worker";
export type { LayoutService, AsyncCachedLayoutEngine, LayoutWorkerApi } from "./worker";
export type {
  DisplayList,
  RenderCommand,
  ScoreInfo,
  PageLayout,
  BoundingBox,
  MeasureBounds,
  SlurGeometry,
  SlurPreview,
  SlurPreviewInput,
  WasmSvgPage,
  CachedLayoutEngine,
  LayoutDebugInfo,
  PageTurnWarning,
  SystemDebug,
  AboveBreakdown,
  BelowBreakdown,
  MeasureExtreme,
  MeasureSpacing,
  StaffPairDebug,
  GapInfo,
  PlacementDebug,
  LayoutMetrics,
} from "./wasm";
export {
  detectStaves,
  detectHorizonStaves,
  findStaffAtPosition,
  snapToStaffPosition,
  getStaffPosition,
  noteheadForDuration,
  paintInputCursor,
  paintGhostNote,
  extractStickyClefInfo,
  paintStickyClefs,
  paintMeasureNumber,
} from "./overlayPainter";
export type { StaffInfo, GhostNoteOptions, StickyClefInfo } from "./overlayPainter";
export {
  PerfTracker,
  isPerfEnabled,
  enablePerfOverlay,
  disablePerfOverlay,
  isTileCacheDisabled,
  disableTileCache,
  enableTileCache,
  getGlobalPerfTracker,
} from "./perfOverlay";
export type { PatchInfo } from "./perfOverlay";
export { TileCache, DEFAULT_TILE_SIZE, computeDisplayListContentBounds, paintCommandsCulled } from "./tileCache";
export {
  computeHorizonPaperGeometry,
  paintPaperPage,
  HORIZON_PAPER_PADDING,
  PAPER_SHADOW_MARGIN,
} from "./paperPagePainter";
export type { HorizonPaperGeometry } from "./paperPagePainter";
export { beatToX, paintPlayhead, paintPlayheadAtPosition, findSystemYExtent, findPageForY } from "./playheadPainter";
export type { PlayheadPosition, PlayheadDraw } from "./playheadPainter";
export { exportPdf } from "./pdfPainter";
export type { PdfExportOptions } from "./pdfPainter";
export { exportSvg, exportSvgPages } from "./svgPainter";
export type { SvgExportOptions, SvgPage } from "./svgPainter";
export { setAssetBasePath } from "./basePath";
