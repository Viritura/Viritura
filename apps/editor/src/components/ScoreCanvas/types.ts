/**
 * Public types for the ScoreCanvas component and its engrave-mode surface.
 * Kept here (not in `ScoreCanvas.tsx`) so the `.tsx` file exports components
 * only, per the `react-refresh/only-export-components` rule and AGENTS.md.
 */
import type { SlurShape } from "@viritura/core";
import type { WriteViewMode as ViewMode } from "@viritura/ui";
import type { ScrollAnchor, ScrollAnchorAxes } from "../../viewport";

interface ViewportInfo {
  zoom: number;
  scrollX: number;
  scrollY: number;
}

// ─── Engrave-mode public types ────────────────────────────────

type EngraveMarkerKind = "system" | "page";

export interface EngraveBreakMarker {
  /** 0-based index of the LAST measure of the system before the break. */
  measureIndex: number;
  /** "system" = ↵ (return arrow), "page" = ⤓ (down arrow with bar). */
  kind: EngraveMarkerKind;
  /** Stable id used to identify the marker in click callbacks. */
  id: string;
}

export interface EngraveAdornments {
  markers?: EngraveBreakMarker[];
  /**
   * Optional provider for staff-eye state. The canvas iterates its own
   * `MeasureBounds` (one per system × visible part) and asks the host for the
   * (visible, hasMusicHidden) flags. Returning `null` suppresses the pill.
   *
   * The host doesn't need to know engine system indices — the canvas resolves
   * them from `MeasureBounds`. The host only needs to map `(systemMeasureId,
   * partId)` → state via its score model.
   *
   * When this is omitted, no staff-eye pills are painted.
   */
  staffEyeProvider?: (systemMeasureId: string, partId: string) => { visible: boolean; hasMusicHidden?: boolean } | null;
  /**
   * Returns ghost-rail groups for a system: each group is a run of consecutive
   * hidden staves between two visible staves (or at the system's top/bottom
   * edge). The canvas collapses these into one rail per group instead of
   * drawing one per hidden staff.
   *
   * `partLabels` is used in the multi-staff popover; defaults to ids if
   * omitted by the host.
   */
  ghostRailGroupProvider?: (systemMeasureId: string) => Array<{
    id: string;
    partIds: string[];
    partLabels?: string[];
    /**
     * Hidden parts grouped by the LayoutStaff they share. One inner array
     * per staff. UI shows one row per inner array (visibility operates on
     * whole staves, not individual sources of a condensed staff).
     */
    staffGroups?: string[][];
    /** Display label per staffGroups inner array (joined source labels). */
    staffGroupLabels?: string[];
    /** Parallel to staffGroups: true if that staff has music in the hidden range. */
    staffGroupHasMusic?: boolean[];
    aboveVisiblePartId: string | null;
    belowVisiblePartId: string | null;
  }>;
}

/**
 * Per-staff visibility affordance painted in the left margin of the first
 * measure of a system. Visible staves get a hover-revealed open Eye; hidden
 * staves (ghost rails) get an always-visible closed Eye, with an optional
 * warning badge when the hidden range contains music.
 */
export interface EngraveStaffEye {
  /** Stable id used in click callbacks (e.g. `${systemMeasureId}|${partId}`). */
  id: string;
  /** Measure id at the start of the system this control belongs to. */
  systemMeasureId: string;
  /** MNX part id whose visibility is being toggled. */
  partId: string;
  /** Current visibility of the staff at this system. */
  visible: boolean;
  /** True if hiding this staff would lose user-authored music. */
  hasMusicHidden?: boolean;
  /** 0-based index of the system this control anchors to. */
  systemIndex: number;
  /** 0-based part index within the score (matches MeasureBounds.partIndex). */
  partIndex: number;
}

export interface StaffEyeHit {
  id: string;
  systemMeasureId: string;
  partId: string;
  visible: boolean;
}

/** Hit-test result for a barline (right edge of a measure). */
export interface BarlineHit {
  /** The measure whose right barline was hit. */
  measureIndex: number;
  partIndex: number;
  staffIndex: number;
  /** Score-coord X of the barline itself. */
  barlineX: number;
  /** Top of the measure staff (score coords). */
  staffTopY: number;
}

export interface EngraveClickModifiers {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface ScoreCanvasProps {
  partIndex?: number;
  /** Keep the layout backend briefly available across Storybook-style remounts. */
  keepLayoutBackendAlive?: boolean;
  /** Currently selected score/layout index (0 = full score) */
  selectedScoreIndex?: number;
  /** Part IDs selected in the panel — when 2+, renders only those parts */
  selectedPartIds?: string[];
  /** Set of staff path keys that are expanded to show source staves on canvas */
  /** Path keys of condensed staves the user has expanded on the canvas. */
  expandedCondensingStaves?: Set<string>;
  /**
   * Toggle a condensed staff's expansion. Supplied by modes that let the user
   * expand condensed staves in place; omit to render no handles.
   */
  onToggleCondensedStaff?: (pathKey: string) => void;
  /** Called whenever the viewport (zoom/scroll) changes */
  onViewportChange?: (info: ViewportInfo) => void;
  /** Called when score info text changes */
  onScoreInfoChange?: (info: string) => void;
  /** Called when hover beat position changes (for debug display) */
  onHoverBeat?: (info: { measureIndex: number; beat: number; scoreX: number } | null) => void;
  /** Called when available layouts change (names array; empty if single layout) */
  onLayoutsChange?: (layouts: string[]) => void;
  /** Called when the page count changes (page view only; 0 for horizon view). */
  onPageCountChange?: (count: number) => void;
  /** Called with 1-based page numbers whose staff lines exceed the printable bottom margin. */
  onPrintOverflowChange?: (pages: number[]) => void;
  /** View mode: "page" (paper layout with system breaks) or "horizon" (continuous, no breaks) */
  viewMode?: ViewMode;
  /** Initial zoom level (default: LIFE_SIZE_ZOOM ≈ 0.315 → "100%" in the UI). */
  initialZoom?: number;
  /**
   * When true, render in a print-preview "what-you-see-is-what-prints" mode:
   * suppresses margin guides, selection overlays, the input cursor, and all
   * pointer interactions (clicks no-op). Used by Publish mode and any future
   * preview surface.
   */
  printPreview?: boolean;
  /**
   * Override how content is anchored within the viewport when it fits along
   * an axis. Pass a single value to apply to both axes, or a per-axis object
   * like `{ x: "center", y: "center" }`. Defaults are picked per view mode
   * (see implementation): horizon uses x=start/y=center, paginated modes
   * use x=start/y=start, print preview uses center on both axes.
   *
   * Storybook snippets typically want `"center"` so a short example sits in
   * the middle of the preview pane.
   */
  scrollAnchor?: ScrollAnchor | ScrollAnchorAxes;
  /**
   * Safe-area insets (in viewport CSS px) the surrounding UI occupies
   * (floating panels, toolbars). When provided, the default scroll
   * position is biased so content clears these regions. Users can still
   * pan content under the panels freely.
   */
  safeArea?: { left?: number; top?: number; right?: number; bottom?: number };
  /**
   * When true, automatically zoom out (never in) so the rendered content
   * fits within the container width. Re-applies on container resize and
   * on content size changes (e.g. live MNX edits in Storybook).
   * Manual wheel-zoom by the user is preserved until the next resize/edit.
   * Used by Storybook's `ScorePreview` to keep wide examples on screen.
   */
  fitToWidth?: boolean;
  /**
   * Interaction intent. "write" (default) keeps the existing behavior.
   * "engrave" suppresses element/measure selection on click and instead
   * routes pointer events through engrave callbacks. Used by Engrave mode.
   */
  interactionMode?: "write" | "engrave";
  /** Engrave-mode adornments (break markers, future: ghost staves). */
  engraveAdornments?: EngraveAdornments;
  /** Currently selected marker id (highlighted on the canvas). */
  selectedEngraveMarkerId?: string | null;
  /** Fired when the user clicks a barline in engrave mode (Ctrl/Shift modifiers). */
  onEngraveBarlineClick?: (hit: BarlineHit, mods: EngraveClickModifiers) => void;
  /** Fired as the pointer moves over barlines in engrave mode (null on leave). */
  onEngraveBarlineHover?: (hit: BarlineHit | null) => void;
  /** Fired when the user clicks a break marker (id from EngraveBreakMarker). */
  onEngraveMarkerClick?: (markerId: string) => void;
  /** Fired when the user clicks empty engrave canvas (used to clear marker selection). */
  onEngraveEmptyClick?: () => void;
  /** Fired when the user clicks a staff-eye pill in engrave mode. */
  onEngraveStaffEyeClick?: (hit: StaffEyeHit) => void;
  /**
   * Fired when the user finishes dragging a slur bezier handle in engrave mode.
   * The `shape` payload is the composed shape (existing overrides + new delta
   * from this drag), expressed in spatia (sp). Consumers should persist this to
   * the corresponding slur as `_x.viritura.shape`.
   */
  onEngraveSlurShapeEdit?: (slurElementId: string, shape: SlurShape) => void;
  /** Fired whenever the engrave-mode "selected slur" changes (null = nothing selected). */
  onEngraveSlurSelectionChange?: (slurElementId: string | null) => void;
  /** Engrave mode: invoked when the user picks "Reset shape" from the slur
   *  bezier-handle context menu. Receives the slur's element id. */
  onEngraveSlurShapeReset?: (slurElementId: string) => void;
  /** Engrave mode: invoked when a slur endpoint handle (p0/p3) is dragged onto
   *  a different note onset. Rewrites which events the slur spans. */
  onEngraveSlurReanchor?: (slurElementId: string, end: "start" | "end", newEventId: string) => void;
  /** Fired when the user drags a text expression in engrave mode. Delta is [dx, dy] in sp. */
  onEngraveTextExpressionOffsetEdit?: (expressionElementId: string, delta: [number, number]) => void;
}
