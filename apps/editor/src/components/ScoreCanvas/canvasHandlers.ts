/* eslint-disable complexity -- canvas interaction layer; each handler is irreducibly large but cohesive */
import type React from "react";
import {
  hitTestSpannerHandle,
  type SpatialIndex,
  type DisplayList,
  type PerfTracker,
  type RenderCommand,
  type SlurGeometry,
} from "@viritura/renderer";
import type { PageSetup, SlurShape, Score } from "@viritura/core";
import type { ContextMenuState } from "@viritura/ui";

import { screenToLayout, visualToEngineCoords } from "./viewportGeometry";
import { findNearbyElement, pointerToBarline, pointerToMeasure } from "./hitTesting";
import {
  ENGRAVE_EYE_SIZE,
  findMarkerHit,
  findStaffEyeHit,
  deriveEngraveAnchors,
  findGhostRailHitFull,
  type DerivedGhostRail,
} from "./engraveAdornments";
import { hitTestSlurHandle } from "./slurHandles";
import { hitTestSlurCurve } from "./slurCurveHit";
import { buildSlurAnchorPoints, nearestSlurAnchor } from "./slurAnchorSnap";
import { findSlurAnchorInfo } from "../../score/ScoreMutations";
import { resolveAnnotationLocation, isEngraveTextAnnotationId } from "../../score/ElementPath";
import { getAnnotationOffset, isMovableAnnotationId } from "../../score/annotationOffsetMutations";
import type { BarlineHit, EngraveAdornments, EngraveClickModifiers, StaffEyeHit } from "./ScoreCanvas";
import type { WriteViewMode as ViewMode } from "@viritura/ui";
import type { SpannerDragState, SlurHandleDragState, TextExpressionDragState } from "./paintScoreFrame";
import type { MeasureSelectionPoint } from "../../store/selectionStore";

/** Pixels per millimetre — canonical rendering density for the layout canvas. */
const PX_PER_MM = 12;

type Ref<T> = { current: T };

interface Viewport {
  zoom: number;
  scrollX: number;
  scrollY: number;
}

interface SpannerSnapPoint {
  x: number;
  beat: number;
  measureIndex: number;
}

export interface CanvasHandlerCtx {
  // Display-time values
  viewport: Viewport;
  viewMode: ViewMode;
  selectedIds: Set<string> | null;
  performanceOverlayEnabled: boolean;

  // Refs (live containers)
  canvasRef: Ref<HTMLCanvasElement | null>;
  spatialIndexRef: Ref<SpatialIndex | null>;
  displayListRef: Ref<DisplayList | null>;
  /** Advances whenever the display list's contents change; keyed caches use it. */
  displayListVersionRef: Ref<number>;
  perfTrackerRef: Ref<PerfTracker>;
  dragOccurredRef: Ref<boolean>;
  mouseDownPosRef: Ref<{ x: number; y: number } | null>;
  dragLockRef: Ref<boolean>;
  spannerDragRef: Ref<SpannerDragState | null>;
  slurHandleDragRef: Ref<SlurHandleDragState | null>;
  textExpressionDragRef: Ref<TextExpressionDragState | null>;
  interactionModeRef: Ref<"write" | "engrave">;
  pageSetupRef: Ref<PageSetup>;
  engraveAdornmentsRef: Ref<EngraveAdornments | undefined>;
  partIdByIndexRef: Ref<readonly string[]>;
  selectedSlurIdRef: Ref<string | null>;
  engraveBarlineHoverRef: Ref<BarlineHit | null>;
  engraveEyeHoverIdRef: Ref<string | null>;
  engraveGhostRailHoverIdRef: Ref<string | null>;
  hoverSlurHandleKeyRef: Ref<string | null>;
  repaintRef: Ref<(() => void) | null | undefined>;
  onEngraveStaffEyeClickRef: Ref<((hit: StaffEyeHit) => void) | undefined>;
  onOpenGhostRailPopoverRef: Ref<((rail: DerivedGhostRail) => void) | undefined>;
  onEngraveMarkerClickRef: Ref<((markerId: string) => void) | undefined>;
  onEngraveBarlineClickRef: Ref<((hit: BarlineHit, mods: EngraveClickModifiers) => void) | undefined>;
  onEngraveBarlineHoverRef: Ref<((hit: BarlineHit | null) => void) | undefined>;
  onEngraveEmptyClickRef: Ref<(() => void) | undefined>;
  onEngraveSlurShapeEditRef: Ref<((slurElementId: string, shape: SlurShape) => void) | undefined>;
  onEngraveSlurShapeResetRef: Ref<((slurElementId: string) => void) | undefined>;
  onEngraveTextExpressionOffsetEditRef: Ref<
    ((expressionElementId: string, delta: [number, number]) => void) | undefined
  >;
  /** Latest document score — read at drag time to compute absolute-grid snapping. */
  docScoreRef: Ref<Score | null>;

  // Callbacks
  repaint: () => void;
  commitSlurReanchor: (slurElementId: string, end: "start" | "end", newEventId: string) => void;
  setSelectedSlurId: (id: string | null) => void;
  selectElement: (id: string, measureAnchor?: MeasureSelectionPoint) => void;
  extendSelection: (id: string) => void;
  toggleSelection: (id: string) => void;
  clearSelection: () => void;
  selectMeasure: (partIndex: number, staffIndex: number, measureIndex: number, localStaffIndex?: number) => void;
  extendMeasure: (partIndex: number, staffIndex: number, measureIndex: number, localStaffIndex?: number) => void;
  toggleNoteInput: () => void;
  commitSpannerDrag: (hit: import("@viritura/renderer").SpannerHandleHit, dragX: number) => void;
  buildDragSnapPoints: (partIdx: number, altKey: boolean) => SpannerSnapPoint[];
  startEngraveHoverFade: () => void;
  setEngraveHoverCursor: React.Dispatch<React.SetStateAction<boolean>>;
  setSlurContextMenu: React.Dispatch<React.SetStateAction<ContextMenuState | null>>;
}

/** Resolve screen coords → engine-space (handling visual→engine page transform).
 * Returns null when the point lies outside any page in multi-page modes. */
function screenToEngine(
  e: React.MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
  ctx: CanvasHandlerCtx,
): { scoreX: number; scoreY: number } | null {
  const rect = canvas.getBoundingClientRect();
  const dl = ctx.displayListRef.current;
  let { scoreX, scoreY } = screenToLayout(
    e.clientX,
    e.clientY,
    rect,
    ctx.viewport.zoom,
    ctx.viewport.scrollX,
    ctx.viewport.scrollY,
  );
  if (dl) {
    const eng = visualToEngineCoords(scoreX, scoreY, dl, ctx.viewMode);
    if (!eng) return null;
    scoreX = eng.engineX;
    scoreY = eng.engineY;
  }
  return { scoreX, scoreY };
}

export function handleCanvasClickImpl(e: React.MouseEvent<HTMLCanvasElement>, ctx: CanvasHandlerCtx): void {
  performance.mark("viritura:input-event");
  // Perf overlay buttons take precedence
  if (ctx.performanceOverlayEnabled) {
    const canvas = ctx.canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const cssX = e.clientX - rect.left;
      const cssY = e.clientY - rect.top;
      if (ctx.perfTrackerRef.current.handleClick(cssX, cssY)) {
        ctx.repaint();
        return;
      }
    }
  }

  if (ctx.dragOccurredRef.current) return;
  if (ctx.spannerDragRef.current) return;

  const canvas = ctx.canvasRef.current;
  const si = ctx.spatialIndexRef.current;
  if (!canvas || !si) return;

  const pt = screenToEngine(e, canvas, ctx);
  if (!pt) {
    ctx.clearSelection();
    return;
  }
  const { scoreX, scoreY } = pt;

  // Engrave-mode: route to eye / ghost-rail / marker / barline / slur / empty
  if (ctx.interactionModeRef.current === "engrave") {
    if (handleEngraveClick(e, ctx, scoreX, scoreY, si)) return;
    return;
  }

  // Write-mode: hit-test → select element or measure. The slur arc is checked
  // first: its spatial-index entry is a loose rectangle that any overlapping
  // notehead/stem box would win, so only the spine cubic can tell whether the
  // user actually clicked the curve.
  const curveHit = hitTestSlurCurve(ctx.displayListRef.current?.slurGeometries, scoreX, scoreY);
  const exactHit = curveHit ?? si.hitTest(scoreX, scoreY);
  const measureBounds = ctx.displayListRef.current?.measureBounds;
  const measureAnchor = pointerToMeasure(scoreX, scoreY, measureBounds);
  // Keep direct clicks near ink forgiving without letting rests or barlines
  // magnetically consume broad areas of otherwise selectable bar space.
  const nearestHit = findNearbyElement(si, scoreX, scoreY, measureBounds);
  const hitId = exactHit ?? nearestHit;

  if (hitId) {
    const isSpannerSegment = hitId.startsWith("slur/") || hitId.startsWith("tie/");
    const eventId = isSpannerSegment || exactHit === hitId ? hitId : hitId.replace(/\/n\d+$/, "");
    if (eventId.startsWith("slur/") && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      ctx.setSelectedSlurId(eventId);
    } else if (ctx.selectedSlurIdRef.current) {
      ctx.setSelectedSlurId(null);
    }
    if (e.shiftKey) ctx.extendSelection(eventId);
    else if (e.ctrlKey || e.metaKey) ctx.toggleSelection(eventId);
    else {
      if (measureAnchor) ctx.selectElement(eventId, measureAnchor);
      else ctx.selectElement(eventId);
    }
  } else {
    if (ctx.selectedSlurIdRef.current) ctx.setSelectedSlurId(null);
    selectMeasureOrClear(e, ctx, scoreX, scoreY);
  }
}

function handleEngraveClick(
  e: React.MouseEvent<HTMLCanvasElement>,
  ctx: CanvasHandlerCtx,
  scoreX: number,
  scoreY: number,
  si: SpatialIndex,
): boolean {
  const dl = ctx.displayListRef.current;
  const ps = ctx.pageSetupRef.current;
  const pageMarginLeftPx = ps.margins.left * PX_PER_MM;

  // 1. Staff-eye pill / single-staff ghost-rail. Both derive from the same
  // memoized anchor bundle (keyed on the display list) so a click pays no more
  // than the first paint already did.
  const adornments = ctx.engraveAdornmentsRef.current;
  if (dl?.measureBounds && (adornments?.staffEyeProvider || adornments?.ghostRailGroupProvider)) {
    const { eyes, rails } = deriveEngraveAnchors(
      dl.measureBounds,
      ctx.partIdByIndexRef.current,
      adornments?.staffEyeProvider,
      adornments?.ghostRailGroupProvider,
      pageMarginLeftPx,
    );
    if (eyes.length > 0) {
      const eyeHit = findStaffEyeHit(scoreX, scoreY, eyes, dl.measureBounds, pageMarginLeftPx);
      if (eyeHit) {
        ctx.onEngraveStaffEyeClickRef.current?.(eyeHit);
        return true;
      }
    }
    const railHit = findGhostRailHitFull(scoreX, scoreY, rails);
    if (railHit) {
      if (railHit.isMulti) {
        // Multi-staff rails open a Radix popover (lifted into ScoreCanvas as a
        // single controlled popover); the canvas no longer renders per-rail DOM.
        ctx.onOpenGhostRailPopoverRef.current?.(railHit);
      } else {
        const partId = railHit.partIds[0]!;
        ctx.onEngraveStaffEyeClickRef.current?.({
          id: `ghost:${railHit.systemMeasureId}|${partId}`,
          systemMeasureId: railHit.systemMeasureId,
          partId,
          visible: false,
        });
      }
      return true;
    }
  }
  // 2. Marker
  const markers = ctx.engraveAdornmentsRef.current?.markers ?? [];
  if (markers.length > 0 && dl?.measureBounds) {
    const hit = findMarkerHit(scoreX, scoreY, markers, dl.measureBounds);
    if (hit) {
      ctx.onEngraveMarkerClickRef.current?.(hit.id);
      return true;
    }
  }
  // 3. Barline (only with modifiers)
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    const bhit = pointerToBarline(scoreX, scoreY, dl?.measureBounds);
    if (bhit) {
      ctx.onEngraveBarlineClickRef.current?.(bhit, {
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
      });
      return true;
    }
  }
  // 3b. Slur handle of already-selected slur — keep selection
  const slurHandleHit = dl?.slurGeometries
    ? hitTestSlurHandle(dl.slurGeometries, ctx.selectedSlurIdRef.current, scoreX, scoreY)
    : null;
  if (slurHandleHit) return true;
  const hitId =
    hitTestSlurCurve(dl?.slurGeometries, scoreX, scoreY) ??
    si.hitTest(scoreX, scoreY) ??
    si.findNearest(scoreX, scoreY, 12);
  if (hitId && hitId.startsWith("slur/")) {
    // Slur selection and text selection are mutually exclusive — clear the
    // global element selection so the notation inspector hides.
    ctx.clearSelection();
    ctx.setSelectedSlurId(hitId);
    return true;
  }
  // Text annotations (expression / dynamic / tempo / rehearsal) select into the
  // shared selection store so the notation-properties inspector opens, mirroring
  // the slur properties panel.
  if (hitId && isEngraveTextAnnotationId(hitId)) {
    if (ctx.selectedSlurIdRef.current) ctx.setSelectedSlurId(null);
    if (e.shiftKey) ctx.extendSelection(hitId);
    else if (e.ctrlKey || e.metaKey) ctx.toggleSelection(hitId);
    else ctx.selectElement(hitId);
    return true;
  }
  // 4. Empty click → deselect
  if (ctx.selectedSlurIdRef.current) ctx.setSelectedSlurId(null);
  ctx.clearSelection();
  ctx.onEngraveEmptyClickRef.current?.();
  return true;
}

function isMovableTextExpressionId(elementId: string | null): elementId is string {
  return elementId !== null && isMovableAnnotationId(elementId);
}

/**
 * Pixels-per-spatium for the given display list. The top-level DisplayList does
 * not carry an `sp` field, so derive it from a `MeasureBounds.height` (the staff
 * height is 4 staff spaces). Falls back to a slur geometry's `sp`, then to the
 * engine's default spatium (1.75mm × PX_PER_MM) so a drag never divides by zero.
 */
function displayListSpatium(dl: DisplayList): number {
  const mb = dl.measureBounds;
  if (mb && mb.length > 0) {
    const h = mb[0]!.height;
    if (h > 0) return h / 4;
  }
  const sg = dl.slurGeometries;
  if (sg && sg.length > 0 && sg[0]!.sp > 0) return sg[0]!.sp;
  return 1.75 * PX_PER_MM;
}

function selectMeasureOrClear(
  e: React.MouseEvent<HTMLCanvasElement>,
  ctx: CanvasHandlerCtx,
  scoreX: number,
  scoreY: number,
): void {
  const dl = ctx.displayListRef.current;
  const mb = dl?.measureBounds;
  if (!mb || mb.length === 0) {
    ctx.clearSelection();
    return;
  }
  const hitMeasure = pointerToMeasure(scoreX, scoreY, mb);
  if (hitMeasure) {
    if (e.shiftKey) {
      ctx.extendMeasure(
        hitMeasure.partIndex,
        hitMeasure.staffIndex,
        hitMeasure.measureIndex,
        hitMeasure.localStaffIndex,
      );
    } else {
      ctx.selectMeasure(
        hitMeasure.partIndex,
        hitMeasure.staffIndex,
        hitMeasure.measureIndex,
        hitMeasure.localStaffIndex,
      );
    }
  } else {
    ctx.clearSelection();
  }
}

export function handleCanvasDoubleClickImpl(e: React.MouseEvent<HTMLCanvasElement>, ctx: CanvasHandlerCtx): void {
  const canvas = ctx.canvasRef.current;
  const si = ctx.spatialIndexRef.current;
  if (!canvas || !si) return;
  const pt = screenToEngine(e, canvas, ctx);
  if (!pt) return;
  const hitId = si.hitTest(pt.scoreX, pt.scoreY);
  if (hitId) ctx.selectElement(hitId);
}

export function handleCanvasMouseDownImpl(e: React.MouseEvent<HTMLCanvasElement>, ctx: CanvasHandlerCtx): void {
  // Middle-click: let viewport pan handle it
  if (e.button === 1) {
    e.preventDefault();
    return;
  }
  // Thumb back button: toggle note-input
  if (e.button === 3) {
    e.preventDefault();
    ctx.toggleNoteInput();
    return;
  }

  ctx.dragOccurredRef.current = false;
  ctx.mouseDownPosRef.current = { x: e.clientX, y: e.clientY };

  const canvas = ctx.canvasRef.current;
  const si = ctx.spatialIndexRef.current;
  if (!canvas || !si) return;
  const pt = screenToEngine(e, canvas, ctx);
  if (!pt) return;
  const { scoreX, scoreY } = pt;

  const dl = ctx.displayListRef.current;
  // Write endpoints re-anchor to notes. In Engrave, every slur handle changes
  // only the drawn shape; movable text also remains Engrave-only.
  if (dl?.slurGeometries && beginSlurHandleDrag(e, ctx, dl, scoreX, scoreY)) return;
  if (ctx.interactionModeRef.current === "engrave" && dl) {
    if (beginTextExpressionDrag(e, ctx, dl, si, scoreX, scoreY)) return;
  }

  // Spanner handle drag
  if (!ctx.selectedIds) return;
  const handleHit = hitTestSpannerHandle(
    si,
    ctx.selectedIds,
    scoreX,
    scoreY,
    dl ?? undefined,
    ctx.displayListVersionRef.current,
  );
  if (handleHit) {
    e.preventDefault();
    ctx.dragLockRef.current = true;
    const bbox = si.getBBox(handleHit.elementId);
    if (!bbox) return;
    const partIdx = resolveAnnotationLocation(handleHit.elementId)?.partIndex ?? 0;
    const initialSnaps = ctx.buildDragSnapPoints(partIdx, e.altKey);
    ctx.spannerDragRef.current = {
      hit: handleHit,
      dragX: handleHit.handleX,
      bbox,
      snapPoints: initialSnaps,
      altKey: e.altKey,
    };

    const onMouseMove = (ev: MouseEvent): void => {
      const r = canvas.getBoundingClientRect();
      const sx = (ev.clientX - r.left) / ctx.viewport.zoom + ctx.viewport.scrollX;
      if (ctx.spannerDragRef.current) {
        ctx.spannerDragRef.current.dragX = sx;
        if (ev.altKey !== ctx.spannerDragRef.current.altKey) {
          ctx.spannerDragRef.current.altKey = ev.altKey;
          ctx.spannerDragRef.current.snapPoints = ctx.buildDragSnapPoints(partIdx, ev.altKey);
        }
        ctx.repaint();
      }
    };
    const onMouseUp = (): void => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      ctx.dragLockRef.current = false;
      const drag = ctx.spannerDragRef.current;
      if (drag) {
        ctx.commitSpannerDrag(drag.hit, drag.dragX);
        ctx.spannerDragRef.current = null;
        ctx.repaint();
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }
}

function beginTextExpressionDrag(
  e: React.MouseEvent<HTMLCanvasElement>,
  ctx: CanvasHandlerCtx,
  dl: DisplayList,
  si: SpatialIndex,
  scoreX: number,
  scoreY: number,
): boolean {
  const hitId = si.hitTest(scoreX, scoreY) ?? si.findNearest(scoreX, scoreY, 12);
  if (!isMovableTextExpressionId(hitId)) return false;

  // Pixels-per-spatium for px→sp conversion. The top-level DisplayList carries
  // no `sp`, so derive it: a MeasureBounds.height is the staff height = 4·sp.
  // Fall back to a slur geometry's sp, then to PX_PER_MM × 1.75mm (the engine's
  // default spatium) so a drag still commits on a degenerate display list.
  const sp = displayListSpatium(dl);

  // Engine-space bbox of the element at drag start — drives the ghost preview.
  const bbox = dl.elementBboxes?.find((b) => b.elementId === hitId)?.bbox ?? null;

  // Capture the element's actual render commands (its DrawText runs) so the
  // paint loop can redraw the real text translated by the drag. `elementIds` is
  // parallel to `commands`; an expression is typically one or two text runs.
  const commands: import("@viritura/renderer").RenderCommand[] = [];
  if (dl.elementIds && dl.commands) {
    for (let i = 0; i < dl.commands.length; i++) {
      if (dl.elementIds[i] === hitId) commands.push(dl.commands[i]!);
    }
  }

  e.preventDefault();
  ctx.dragLockRef.current = true;

  const expressionId = hitId;
  const startClientX = e.clientX;
  const startClientY = e.clientY;

  // Current stored offset (sp, +x right / +y up) — the base the drag moves from.
  // Holding Ctrl/Cmd snaps the *resulting* offset to the nearest 0.5sp grid.
  const score = ctx.docScoreRef.current;
  const baseOffset = (score && getAnnotationOffset(score, expressionId)) ?? [0, 0];

  /** Resulting committed delta (sp) for the pointer event, snapped to a 0.5sp
   *  absolute grid when Ctrl/Cmd is held. Screen y grows downward while stored
   *  y is +up, so dy is negated. */
  const computeDelta = (ev: MouseEvent): { dxSp: number; dySp: number } => {
    const rawDxSp = (ev.clientX - startClientX) / ctx.viewport.zoom / sp;
    const rawDySp = -((ev.clientY - startClientY) / ctx.viewport.zoom) / sp;
    if (ev.ctrlKey || ev.metaKey) {
      const snap = (v: number) => Math.round(v * 2) / 2;
      return {
        dxSp: snap(baseOffset[0] + rawDxSp) - baseOffset[0],
        dySp: snap(baseOffset[1] + rawDySp) - baseOffset[1],
      };
    }
    return { dxSp: rawDxSp, dySp: rawDySp };
  };

  const onMove = (ev: MouseEvent): void => {
    if (!ctx.dragLockRef.current) return;
    if (Math.abs(ev.clientX - startClientX) > 2 || Math.abs(ev.clientY - startClientY) > 2) {
      ctx.dragOccurredRef.current = true;
    }
    // Update the live-drag state and repaint so the real text follows the
    // cursor. Requires both the bbox (to occlude the original) and the captured
    // commands (the text to redraw). The ghost translates in screen px, so
    // convert the (possibly snapped) committed delta back: +x right, +y up.
    if (bbox && commands.length > 0) {
      const { dxSp, dySp } = computeDelta(ev);
      ctx.textExpressionDragRef.current = {
        elementId: expressionId,
        bbox,
        commands,
        dxPx: dxSp * sp,
        dyPx: -dySp * sp,
      };
      ctx.repaintRef.current?.();
    }
  };

  const onUp = (ev: MouseEvent): void => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    ctx.dragLockRef.current = false;
    ctx.textExpressionDragRef.current = null;
    const { dxSp, dySp } = computeDelta(ev);
    if (Math.abs(dxSp) > 1e-4 || Math.abs(dySp) > 1e-4) {
      ctx.onEngraveTextExpressionOffsetEditRef.current?.(expressionId, [dxSp, dySp]);
      ctx.repaint();
    } else {
      // No commit (a click, not a drag) — still clear the ghost.
      ctx.repaintRef.current?.();
    }
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  return true;
}

function beginSlurHandleDrag(
  e: React.MouseEvent<HTMLCanvasElement>,
  ctx: CanvasHandlerCtx,
  dl: DisplayList,
  scoreX: number,
  scoreY: number,
): boolean {
  if (!dl.slurGeometries) return false;
  const scope = ctx.interactionModeRef.current === "write" ? "endpoints" : "all";
  const slurHit = hitTestSlurHandle(dl.slurGeometries, ctx.selectedSlurIdRef.current, scoreX, scoreY, scope);
  if (!slurHit) return false;
  const sourceCommand = findSlurRenderCommand(dl, slurHit.elementId, slurHit.geom);
  if (!sourceCommand) return false;
  e.preventDefault();
  ctx.dragLockRef.current = true;
  const startEngineX =
    slurHit.handle === "p0"
      ? slurHit.geom.p0x
      : slurHit.handle === "p1"
        ? slurHit.geom.p1x
        : slurHit.handle === "p2"
          ? slurHit.geom.p2x
          : slurHit.handle === "p3"
            ? slurHit.geom.p3x
            : (slurHit.geom.p0x + 3 * slurHit.geom.p1x + 3 * slurHit.geom.p2x + slurHit.geom.p3x) / 8;
  const startEngineY =
    slurHit.handle === "p0"
      ? slurHit.geom.p0y
      : slurHit.handle === "p1"
        ? slurHit.geom.p1y
        : slurHit.handle === "p2"
          ? slurHit.geom.p2y
          : slurHit.handle === "p3"
            ? slurHit.geom.p3y
            : (slurHit.geom.p0y + 3 * slurHit.geom.p1y + 3 * slurHit.geom.p2y + slurHit.geom.p3y) / 8;
  ctx.slurHandleDragRef.current = {
    elementId: slurHit.elementId,
    handle: slurHit.handle,
    startEngineX,
    startEngineY,
    dxPx: 0,
    dyPx: 0,
    sp: slurHit.sp,
    geom: slurHit.geom,
    sourceCommand,
    anchor:
      ctx.interactionModeRef.current === "write"
        ? buildSlurAnchorDrag(ctx, slurHit.elementId, slurHit.handle, startEngineX, startEngineY)
        : undefined,
  };

  const startClientX = e.clientX;
  const startClientY = e.clientY;
  const onSlurMove = (ev: MouseEvent): void => {
    const drag = ctx.slurHandleDragRef.current;
    if (!drag) return;
    drag.dxPx = (ev.clientX - startClientX) / ctx.viewport.zoom;
    drag.dyPx = (ev.clientY - startClientY) / ctx.viewport.zoom;
    if (Math.abs(ev.clientX - startClientX) > 2 || Math.abs(ev.clientY - startClientY) > 2) {
      ctx.dragOccurredRef.current = true;
    }
    if (drag.anchor) {
      drag.anchor.dragX = drag.startEngineX + drag.dxPx;
      drag.anchor.dragY = drag.startEngineY + drag.dyPx;
    }
    ctx.repaint();
  };
  const onSlurUp = (): void => {
    window.removeEventListener("mousemove", onSlurMove);
    window.removeEventListener("mouseup", onSlurUp);
    ctx.dragLockRef.current = false;
    const drag = ctx.slurHandleDragRef.current;
    ctx.slurHandleDragRef.current = null;
    if (drag) {
      if (drag.anchor) commitSlurAnchorDrag(ctx, drag, drag.anchor);
      else commitSlurShapeDrag(ctx, drag);
      ctx.repaint();
    }
  };
  window.addEventListener("mousemove", onSlurMove);
  window.addEventListener("mouseup", onSlurUp);
  return true;
}

function findSlurRenderCommand(
  dl: DisplayList,
  elementId: string,
  geometry: SlurGeometry,
): Extract<RenderCommand, { type: "DrawFilledBezier" }> | null {
  for (let index = 0; index < dl.commands.length; index++) {
    if (dl.elementIds?.[index] !== elementId) continue;
    const command = dl.commands[index];
    if (
      command?.type === "DrawFilledBezier" &&
      Math.abs(command.x1 - geometry.p0x) < 0.01 &&
      Math.abs(command.y1 - geometry.p0y) < 0.01 &&
      Math.abs(command.x2 - geometry.p3x) < 0.01 &&
      Math.abs(command.y2 - geometry.p3y) < 0.01
    ) {
      return command;
    }
  }
  return null;
}

/**
 * Build the Write-mode note-onset ruler used to re-anchor an endpoint.
 * Returns undefined for control points or when the slur cannot be located.
 */
function buildSlurAnchorDrag(
  ctx: CanvasHandlerCtx,
  elementId: string,
  handle: SlurHandleDragState["handle"],
  startEngineX: number,
  startEngineY: number,
): SlurHandleDragState["anchor"] {
  if (handle !== "p0" && handle !== "p3") return undefined;
  const score = ctx.docScoreRef.current;
  if (!score) return undefined;
  const info = findSlurAnchorInfo(score, elementId);
  if (!info) return undefined;
  const oppositeEventId = handle === "p0" ? info.targetEventId : info.sourceEventId;
  const points = buildSlurAnchorPoints(score, ctx.spatialIndexRef.current, info.partIndex).filter(
    (point) => point.eventId !== oppositeEventId,
  );
  if (points.length === 0) return undefined;
  return { end: handle === "p0" ? "start" : "end", points, dragX: startEngineX, dragY: startEngineY };
}

/** Snap the dragged endpoint to the nearest note onset and rewrite the model. */
function commitSlurAnchorDrag(
  ctx: CanvasHandlerCtx,
  drag: SlurHandleDragState,
  anchor: NonNullable<SlurHandleDragState["anchor"]>,
): void {
  if (Math.abs(drag.dxPx) < 1e-4) return;
  const snapped = nearestSlurAnchor(anchor.points, anchor.dragX, anchor.dragY);
  if (!snapped) return;
  ctx.commitSlurReanchor(drag.elementId, anchor.end, snapped.eventId);
}

/** Engrave handles write `_x.viritura` sp deltas on the drawn curve. */
function commitSlurShapeDrag(ctx: CanvasHandlerCtx, drag: SlurHandleDragState): void {
  const dxSp = drag.dxPx / drag.sp;
  const dySp = drag.dyPx / drag.sp;
  if (Math.abs(dxSp) <= 1e-4 && Math.abs(dySp) <= 1e-4) return;
  const shape: SlurShape = {};
  const delta: [number, number] = [dxSp, dySp];
  if (drag.handle === "p0") shape.p0 = delta;
  else if (drag.handle === "p1") shape.p1 = delta;
  else if (drag.handle === "p2") shape.p2 = delta;
  else if (drag.handle === "p3") shape.p3 = delta;
  else {
    // Midpoint drag: move both control points by (4/3)D so the on-curve
    // midpoint translates by exactly D.
    const cp: [number, number] = [dxSp * (4 / 3), dySp * (4 / 3)];
    shape.p1 = cp;
    shape.p2 = cp;
  }
  ctx.onEngraveSlurShapeEditRef.current?.(drag.elementId, shape);
}

export function handleCanvasMouseUpImpl(e: React.MouseEvent<HTMLCanvasElement>, ctx: CanvasHandlerCtx): void {
  const start = ctx.mouseDownPosRef.current;
  if (start) {
    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    ctx.dragOccurredRef.current = dx > 3 || dy > 3;
  }
}

export function handleCanvasMouseMoveImpl(e: React.MouseEvent<HTMLCanvasElement>, ctx: CanvasHandlerCtx): void {
  const canvas = ctx.canvasRef.current;
  if (!canvas) return;
  const dl = ctx.displayListRef.current;
  const pt = screenToEngine(e, canvas, ctx);
  if (!pt) {
    if (ctx.engraveBarlineHoverRef.current) {
      ctx.engraveBarlineHoverRef.current = null;
      ctx.onEngraveBarlineHoverRef.current?.(null);
      ctx.repaintRef.current?.();
    }
    return;
  }
  const { scoreX, scoreY } = pt;

  if (ctx.interactionModeRef.current === "write") {
    updateSlurHandleHover(ctx, dl, scoreX, scoreY, "endpoints");
    return;
  }

  const hit = pointerToBarline(scoreX, scoreY, dl?.measureBounds);
  const prev = ctx.engraveBarlineHoverRef.current;
  const same =
    !!prev &&
    !!hit &&
    prev.partIndex === hit.partIndex &&
    prev.staffIndex === hit.staffIndex &&
    prev.measureIndex === hit.measureIndex;
  if (!same) {
    ctx.engraveBarlineHoverRef.current = hit;
    ctx.onEngraveBarlineHoverRef.current?.(hit);
    ctx.repaintRef.current?.();
  }

  // Eye-pill / single-staff ghost-rail hover. Runs on every mousemove, so it
  // shares the same memoized anchor bundle the painter uses — no per-move
  // re-walk of every (system, part).
  let nextEyeId: string | null = null;
  let nextRailId: string | null = null;
  if (dl?.measureBounds) {
    const ps = ctx.pageSetupRef.current;
    const pageMarginLeftPx = ps.margins.left * PX_PER_MM;
    const adornments = ctx.engraveAdornmentsRef.current;
    if (adornments?.staffEyeProvider || adornments?.ghostRailGroupProvider) {
      const { eyes, rails } = deriveEngraveAnchors(
        dl.measureBounds,
        ctx.partIdByIndexRef.current,
        adornments?.staffEyeProvider,
        adornments?.ghostRailGroupProvider,
        pageMarginLeftPx,
      );
      if (eyes.length > 0) {
        const eyeHit = findStaffEyeHit(scoreX, scoreY, eyes, dl.measureBounds, pageMarginLeftPx);
        if (eyeHit) nextEyeId = eyeHit.id;
      }
      const r = ENGRAVE_EYE_SIZE / 2 + 4;
      for (const rail of rails) {
        if (scoreX >= rail.cx - r && scoreX <= rail.cx + r && scoreY >= rail.cy - r && scoreY <= rail.cy + r) {
          nextRailId = rail.id;
          break;
        }
      }
    }
  }
  if (nextEyeId !== ctx.engraveEyeHoverIdRef.current || nextRailId !== ctx.engraveGhostRailHoverIdRef.current) {
    ctx.engraveEyeHoverIdRef.current = nextEyeId;
    ctx.engraveGhostRailHoverIdRef.current = nextRailId;
    ctx.startEngraveHoverFade();
  }

  // Slur handle hover
  const nextSlurHandleKey = updateSlurHandleHover(ctx, dl, scoreX, scoreY, "all");

  const wantPointer =
    nextEyeId !== null ||
    nextRailId !== null ||
    nextSlurHandleKey !== null ||
    ((ctx.engraveAdornmentsRef.current?.markers?.length ?? 0) > 0 && dl?.measureBounds
      ? !!findMarkerHit(scoreX, scoreY, ctx.engraveAdornmentsRef.current!.markers!, dl.measureBounds)
      : false);
  ctx.setEngraveHoverCursor((prevPtr) => (prevPtr === wantPointer ? prevPtr : wantPointer));
}

export function handleCanvasMouseLeaveImpl(ctx: CanvasHandlerCtx): void {
  if (ctx.interactionModeRef.current === "write") {
    if (ctx.hoverSlurHandleKeyRef.current) {
      ctx.hoverSlurHandleKeyRef.current = null;
      ctx.setEngraveHoverCursor(false);
      ctx.repaintRef.current?.();
    }
    return;
  }
  let dirty = false;
  if (ctx.engraveBarlineHoverRef.current) {
    ctx.engraveBarlineHoverRef.current = null;
    ctx.onEngraveBarlineHoverRef.current?.(null);
    dirty = true;
  }

  if (ctx.engraveEyeHoverIdRef.current || ctx.engraveGhostRailHoverIdRef.current) {
    ctx.engraveEyeHoverIdRef.current = null;
    ctx.engraveGhostRailHoverIdRef.current = null;
    dirty = true;
    ctx.startEngraveHoverFade();
  }
  if (ctx.hoverSlurHandleKeyRef.current) {
    ctx.hoverSlurHandleKeyRef.current = null;
    dirty = true;
  }
  ctx.setEngraveHoverCursor(false);
  if (dirty) ctx.repaintRef.current?.();
}

function updateSlurHandleHover(
  ctx: CanvasHandlerCtx,
  dl: DisplayList | null,
  scoreX: number,
  scoreY: number,
  scope: "all" | "endpoints",
): string | null {
  const hit = hitTestSlurHandle(dl?.slurGeometries, ctx.selectedSlurIdRef.current, scoreX, scoreY, scope);
  const nextKey = hit ? `${hit.elementId}::${hit.handle}` : null;
  if (nextKey !== ctx.hoverSlurHandleKeyRef.current) {
    ctx.hoverSlurHandleKeyRef.current = nextKey;
    ctx.setEngraveHoverCursor(nextKey !== null);
    ctx.repaintRef.current?.();
  }
  return nextKey;
}

export function handleCanvasContextMenuImpl(e: React.MouseEvent<HTMLCanvasElement>, ctx: CanvasHandlerCtx): void {
  if (ctx.interactionModeRef.current !== "engrave") return;
  const canvas = ctx.canvasRef.current;
  const si = ctx.spatialIndexRef.current;
  const dl = ctx.displayListRef.current;
  if (!canvas || !si || !dl) return;
  const pt = screenToEngine(e, canvas, ctx);
  if (!pt) return;
  const { scoreX, scoreY } = pt;

  let targetSlurId: string | null = null;
  const handleHit = hitTestSlurHandle(dl.slurGeometries, ctx.selectedSlurIdRef.current, scoreX, scoreY);
  if (handleHit) {
    targetSlurId = handleHit.elementId;
  } else {
    const hitId = hitTestSlurCurve(dl.slurGeometries, scoreX, scoreY) ?? si.hitTest(scoreX, scoreY);
    if (hitId && hitId.startsWith("slur/")) {
      targetSlurId = hitId;
      ctx.setSelectedSlurId(hitId);
    }
  }
  if (!targetSlurId) return;
  e.preventDefault();
  const slurId = targetSlurId;
  ctx.setSlurContextMenu({
    x: e.clientX,
    y: e.clientY,
    items: [
      {
        label: "Reset shape",
        action: () => {
          ctx.onEngraveSlurShapeResetRef.current?.(slurId);
          ctx.setSlurContextMenu(null);
        },
      },
    ],
  });
}
