/**
 * WASM display-list / debug / score types — extracted from wasm.ts to keep
 * that module under the lint max-lines threshold. Re-exported from wasm.ts.
 */

// Types matching the Rust DisplayList serialization
export interface PageLayout {
  pageNumber: number;
  systemIndices: number[];
  yOffset: number;
  height: number;
}

export interface RetainedRenderLayer {
  displayList: DisplayList;
  bounds: { x: number; y: number; x2: number; y2: number } | null;
  /** Order-dependent state commands that must still run when the layer is off-screen. */
  stateCommands: Extract<RenderCommand, { type: "SetOpacity" }>[];
}

export interface DisplayList {
  commands: RenderCommand[];
  width: number;
  height: number;
  pages?: PageLayout[];
  /** Element IDs parallel to commands. Maps render commands to model paths for hit-testing. */
  elementIds?: (string | null)[];
  elementBboxes?: ElementBBox[];
  /** Bezier spine geometry for each slur, keyed by element_id. Engrave mode
   * paints drag handles and hit-tests against this without decoding render commands. */
  slurGeometries?: SlurGeometry[];
  /** Measure layout bounds from the Rust engine for cursor/ruler positioning. */
  measureBounds?: MeasureBounds[];
  /** Vertical-spacing debug sidecar. Populated when `setEmitLayoutDebug(true)`. */
  layoutDebug?: LayoutDebugInfo;
  /** Flagged physical page turns from the auto-page-break optimizer. Populated
   * only when page turns are enabled and the layout is paged. */
  pageTurnWarnings?: PageTurnWarning[];
  /** Transient non-enumerable PatchFrame partitions used for coarse direct-paint culling. */
  retainedRenderLayers?: RetainedRenderLayer[];
  /** Transient one-shot hook that updates flattened compatibility stores after
   * retained-layer Horizon paint. Never serialized or exported. */
  finalizeRetainedFrame?: () => void;
}

/**
 * A flagged physical page turn surfaced from the engine's page-turn optimizer.
 * Mirrors the Rust `render::PageTurnWarning`.
 */
export interface PageTurnWarning {
  /** The turn lands at the boundary between this measure index and the next. */
  boundaryMeasure: number;
  /** One of `"tight"`, `"impossible"`, `"structural"`, `"fermata"`. */
  kind: string;
  /** Available turn time in seconds at this boundary. */
  turnSeconds: number;
}

/**
 * Spine cubic bezier for a single slur. The painted shape is a crescent
 * built from outer/inner contours offset perpendicularly by `thickness/2`,
 * but the *spine* (p0,p1,p2,p3) is the logical handle representation that
 * engrave-mode edits.
 */
export interface SlurGeometry {
  elementId: string;
  p0x: number;
  p0y: number;
  p1x: number;
  p1y: number;
  p2x: number;
  p2y: number;
  p3x: number;
  p3y: number;
  thickness: number;
  /** +1.0 = curve below the chord; -1.0 = curve above. */
  curveDir: number;
  /** Spatium (px-per-sp) for this slur; engrave mode uses it to convert px drags into sp. */
  sp: number;
}

export interface SlurPreviewInput {
  spine: [[number, number], [number, number], [number, number], [number, number]];
  thickness: number;
  endpointThickness: number;
  curveDir: number;
  lineStyle: number;
  mode: "write" | "engrave";
  handle: "p0" | "p1" | "p2" | "p3" | "pm";
  dx: number;
  dy: number;
}

export interface SlurPreview {
  command: DrawFilledBezier;
  spine: [[number, number], [number, number], [number, number], [number, number]];
}

// ── Vertical-spacing debug sidecar ────────────────────────────────

export interface LayoutDebugInfo {
  systems: SystemDebug[];
  /** Pixels per spatium used by this layout. */
  sp: number;
  /** Standard staff height (4 * sp). */
  staffHeight: number;
  /** `LayoutConfig.min_note_spacing * sp` — minimum per-event gap floor (pixels). */
  minNoteSpacing: number;
  /** `LayoutConfig.shortest_duration_space * sp` — base width for the shortest duration (pixels). */
  shortestDurationSpace: number;
  /** `LayoutConfig.spacing_increment * sp` — extra width per doubling of duration (pixels). */
  spacingIncrement: number;
  /**
   * Resolved placement metrics per dependent kind, in pixels (spatium already
   * applied). Keyed by the camelCase kind name (`dynamic`, `expression`, …).
   * The overlay draws each dependent's collision box + padding halo around its
   * ink bbox from these numbers. Absent on older engine builds.
   */
  placement?: Record<string, PlacementDebug>;
}

/** Resolved placement metrics for one dependent kind, in pixels. */
export interface PlacementDebug {
  /** Minimum clearance from the element's own anchor edge (pixels). */
  attachGap: number;
  /** Staff-reserve gap for an above-staff placement (pixels). */
  attachGapAbove: number;
  /** Staff-reserve gap for a below-staff placement (pixels). */
  attachGapBelow: number;
  /** Gap kept above the previous stacked dependent (pixels). */
  stackGap: number;
  /** Ordering within a stacked column; lower sits closer to the staff. */
  stackRank: number;
  /** Horizontal clearance kept from neighbouring ink (pixels). */
  sideBearing: number;
}

export interface SystemDebug {
  index: number;
  pageIndex: number;
  bboxTopY: number;
  staffTopY: number;
  staffBottomY: number;
  bboxBottomY: number;
  xStart: number;
  xEnd: number;
  aboveExtra: number;
  aboveBreakdown: AboveBreakdown;
  belowExtra: number;
  belowBreakdown: BelowBreakdown;
  measureExtremes: MeasureExtreme[];
  staffPairs: StaffPairDebug[];
  /** Per-measure horizontal spacing breakdown. Single-staff systems only for now. */
  measureSpacings: MeasureSpacing[];
  interSystemGapToNext: GapInfo | null;
}

export interface AboveBreakdown {
  stemExtra: number;
  annotationExtra: number;
  hasTempo: boolean;
  hasRehearsal: boolean;
  hasJump: boolean;
}

export interface BelowBreakdown {
  protrusion: number;
  dynamics: number;
  lyrics: number;
  pedals: number;
  hasDynamics: boolean;
  hasLyrics: boolean;
  hasPedals: boolean;
}

export interface MeasureExtreme {
  measureIndex: number;
  xStart: number;
  xEnd: number;
  /** Highest point in the measure (most negative = furthest above). */
  highestPoint: number;
  /** Lowest point in the measure (most positive = furthest below). */
  lowestPoint: number;
}

export interface MeasureSpacing {
  measureIndex: number;
  xStart: number;
  xEnd: number;
  /** Width before system-wide justification scaled it (pixels). */
  naturalWidth: number;
  /** Width after justification (pixels) — equals xEnd - xStart. */
  justifiedWidth: number;
  /** justifiedWidth / naturalWidth. <1 = compressed, =1 = natural, >1 = stretched. */
  scale: number;
  /** Sorted, deduplicated event onset X positions inside the measure (pixels). */
  eventXs: number[];
  /** Smallest gap between adjacent event onsets (pixels). 0 if fewer than two events. */
  minGap: number;
  /** Largest gap between adjacent event onsets (pixels). */
  maxGap: number;
}

export interface StaffPairDebug {
  upperStaffIndex: number;
  justifiedGap: number;
  contentGap: number;
  actualGap: number;
  minClearance: number;
  upperStaffBottomY: number;
  lowerStaffTopY: number;
  upperLowestY: number;
  lowerAboveProtrusion: number;
}

export interface GapInfo {
  defaultGap: number;
  actualGap: number;
  justified: boolean;
}

export type RenderCommand =
  | DrawEllipse
  | DrawLine
  | DrawBezier
  | DrawQuadratic
  | DrawRect
  | DrawCircle
  | DrawText
  | DrawGlyph
  | DrawStretchedGlyph
  | DrawFilledBezier
  | DrawPolygon
  | SetOpacity;

export interface DrawEllipse {
  type: "DrawEllipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number;
  filled: boolean;
  color: string;
}

export interface DrawLine {
  type: "DrawLine";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: string;
}

export interface DrawBezier {
  type: "DrawBezier";
  x1: number;
  y1: number;
  cx1: number;
  cy1: number;
  cx2: number;
  cy2: number;
  x2: number;
  y2: number;
  width: number;
  color: string;
}

export interface DrawQuadratic {
  type: "DrawQuadratic";
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  x2: number;
  y2: number;
  width: number;
  color: string;
}

export interface DrawRect {
  type: "DrawRect";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface DrawCircle {
  type: "DrawCircle";
  cx: number;
  cy: number;
  r: number;
  color: string;
}

export interface DrawText {
  type: "DrawText";
  x: number;
  y: number;
  text: string;
  font: string;
  size: number;
  color: string;
  align: "left" | "center" | "right";
  baseline: "top" | "middle" | "bottom" | "alphabetic";
}

export interface DrawGlyph {
  type: "DrawGlyph";
  x: number;
  y: number;
  codepoint: number;
  font: string;
  size: number;
  color: string;
  /** Rotation in radians (clockwise). 0 = no rotation. Used for rotated arpeggio segment glyphs. */
  rotation: number;
}

/**
 * A SMuFL glyph drawn with an independent horizontal scale. `size` sets the
 * vertical scale exactly as it does for `DrawGlyph`; `scaleX` then multiplies
 * the horizontal axis about the glyph origin. Used by the staff brace, which
 * has to reach staves further apart than any brace design anticipates without
 * getting heavier as it stretches.
 */
export interface DrawStretchedGlyph {
  type: "DrawStretchedGlyph";
  x: number;
  y: number;
  codepoint: number;
  font: string;
  size: number;
  /** Horizontal scale about (x, y). 1 draws the glyph proportionally. */
  scale_x: number;
  color: string;
}

export interface DrawFilledBezier {
  type: "DrawFilledBezier";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Outer contour control points */
  ocx1: number;
  ocy1: number;
  ocx2: number;
  ocy2: number;
  /** Inner contour control points */
  icx1: number;
  icy1: number;
  icx2: number;
  icy2: number;
  /** Inner endpoints (tip thickness): (x1,y1)/(x2,y2) are outer-contour tips;
   *  (ix1,iy1)/(ix2,iy2) are inner-contour tips, perpendicular-inward by the
   *  endpoint thickness so tips have finite width instead of being sharp points. */
  ix1: number;
  iy1: number;
  ix2: number;
  iy2: number;
  color: string;
  /** Line style: 0=solid, 1=dashed, 2=dotted */
  line_style: number;
}

export interface DrawPolygon {
  type: "DrawPolygon";
  points: [number, number][];
  color: string;
}

export interface SetOpacity {
  type: "SetOpacity";
  opacity: number;
}

/** Axis-aligned bounding box for a rendered element. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A bounding box associated with a logical element via its ID. */
export interface ElementBBox {
  elementId: string;
  bbox: BoundingBox;
}

/** Layout bounds for a single measure, exported from the Rust engine. */
export interface MeasureBounds {
  /** Measure index (0-based). */
  index: number;
  /** Global measure ID (if assigned). */
  measureId?: string;
  /** Part index (0-based). */
  partIndex: number;
  /** Visual staff index (unique per rendered staff line). */
  staffIndex: number;
  /** 0-based index of the system this measure belongs to. */
  systemIndex?: number;
  /** X position of the left barline. */
  x: number;
  /** Total width (right barline = x + width). */
  width: number;
  /** Y position of the top staff line. */
  y: number;
  /** Height of the staff (4 staff spaces). */
  height: number;
  /** Width of the prefix area (clef, key sig, time sig). Content starts at x + prefixWidth. */
  prefixWidth: number;
  /** Total beats in the measure (from time signature). */
  totalBeats: number;
  /** Beat→X anchor points: each entry is [beat_position, absolute_x].
   * These are the actual positions used by the layout engine for note placement. */
  beatAnchors: [number, number][];
  /** True when this bound represents a ghost rail for an omitted part at this system. */
  ghostStaff?: boolean;
  /** True when the part is hidden at this system (always true for ghost rails). */
  isHidden?: boolean;
  /** True when a hidden part contains audible music at this system. */
  hasMusicHidden?: boolean;
  /** True when this bound is a synthetic "expansion" (ghost) staff for a single
   * source of a condensed multi-source staff. Editor uses this to route edits
   * to that source directly (skipping condensing broadcast). */
  isExpansion?: boolean;
}

export interface ScoreInfo {
  partCount: number;
  partNames: string[];
  measureCount: number;
  layoutCount: number;
  scoreCount: number;
  scoreNames: string[];
}
