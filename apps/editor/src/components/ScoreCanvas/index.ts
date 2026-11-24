export {
  ScoreCanvas,
  type ScoreCanvasHandle,
  type ScoreCanvasProps,
  type EngraveBreakMarker,
  type EngraveAdornments,
  type StaffEyeHit,
  type BarlineHit,
  type EngraveClickModifiers,
} from "./ScoreCanvas";
export type { SelectionMenuContext } from "./types";
export type { ViewportInfo } from "./types";
export { readerAdvance, readerGeometry } from "./readerAdvance";
export type { ReaderAdvance, ReaderMeasure, ReaderSystem, ReaderViewMode } from "./readerAdvance";
export { computePagePlacements } from "./viewportGeometry";
export type { PagePlacement } from "./viewportGeometry";
export { sourcePartMnx } from "./sourcePartProjection";
