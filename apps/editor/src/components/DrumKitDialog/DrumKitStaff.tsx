import {
  useRef,
  useMemo,
  useState,
  useCallback,
  useEffect,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ScoreView, useScoreView } from "@viritura/score-viewer-react";
import {
  detectStaves,
  SpatialIndex,
  getElementType,
  paintSelectionOverlay,
  type ElementBBox,
} from "@viritura/renderer";
import type { KitComponentEdit } from "./types";
import { buildKitSliceMnx, orderedSliceComponents, slicePageWidth, SLICE_SPATIUM } from "./drumKitSlice";
import { staffPositionFromDlY } from "./drumKitStaffInteraction";
import styles from "./DrumKitStaff.module.css";

export interface DrumKitStaffProps {
  readonly rows: readonly KitComponentEdit[];
  readonly selectedId: string | null;
  /** Add a new component at the clicked staff position. */
  readonly onAdd: (staffPosition: number) => void;
  /** Move an existing component to a new staff position (drag). */
  readonly onMove: (id: string, staffPosition: number) => void;
  /** Select a component (click without drag). */
  readonly onSelect: (id: string) => void;
}

/** Movement (px) beyond which a pointer gesture counts as a drag, not a click. */
const DRAG_THRESHOLD = 3;
/** Vertical padding (display-list px) kept around the music when cropping. */
const CROP_PAD = 8;
/** Extra wrap height so a horizontal scrollbar (wide kit) doesn't clip the
 *  lowest note. Harmless when no scrollbar is shown. */
const SCROLLBAR_ALLOWANCE = 14;

/** Don't paint a page fill — the music blends into the dialog surface. */
const PAGE_STYLE: CSSProperties = { boxShadow: "none", background: "transparent" };

/**
 * Interactive percussion staff. The staff, clef and noteheads are rendered by
 * the real engraving engine from a preview MNX slice; a transparent overlay
 * maps pointer gestures to add / move / select using the engine's own
 * geometry (detected staff lines + element bounding boxes).
 *
 * The engine lays out a full page whose margins dwarf a one-line kit staff, so
 * the overlay reports the music's content bounds and we crop to them (negative
 * top margin + fixed height) — no page margin, no white paper, no shadow.
 */
export function DrumKitStaff({ rows, selectedId, onAdd, onMove, onSelect }: DrumKitStaffProps) {
  const sliceMnx = useMemo(() => buildKitSliceMnx(rows), [rows]);
  const orderedIds = useMemo(() => orderedSliceComponents(rows).map((c) => c.id), [rows]);
  const pageWidth = useMemo(() => slicePageWidth(rows.length), [rows.length]);
  const [crop, setCrop] = useState<{ top: number; height: number; left: number; width: number } | null>(null);

  // Width of the wrap's content box (excludes padding/border) — used to center
  // the cropped staff horizontally when it's narrower than the available space.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [wrapWidth, setWrapWidth] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setWrapWidth(cr.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleBounds = useCallback((top: number, bottom: number, left: number, right: number) => {
    const cropTop = Math.max(0, top - CROP_PAD);
    const cropLeft = Math.max(0, left - CROP_PAD);
    setCrop({
      top: cropTop,
      height: bottom + CROP_PAD - cropTop,
      left: cropLeft,
      width: right + CROP_PAD - cropLeft,
    });
  }, []);

  const wrapStyle = useMemo<CSSProperties | undefined>(
    () => (crop ? { height: crop.height + SCROLLBAR_ALLOWANCE } : undefined),
    [crop],
  );
  // Left crop pulls the music to x=0; when the wrap is wider than the cropped
  // staff, an extra offset centers it in the available space.
  const scoreStyle = useMemo<CSSProperties>(() => {
    if (!crop) return { marginTop: 0, marginLeft: 0 };
    const centerOffset = Math.max(0, (wrapWidth - crop.width) / 2);
    return { marginTop: -crop.top, marginLeft: -crop.left + centerOffset };
  }, [crop, wrapWidth]);

  return (
    <div ref={wrapRef} className={styles.wrap} style={wrapStyle}>
      <ScoreView
        mnx={sliceMnx}
        pageWidth={pageWidth}
        spatium={SLICE_SPATIUM}
        viewMode="page"
        className={styles.score}
        style={scoreStyle}
        pageBackground="transparent"
        pageStyle={PAGE_STYLE}
        loadingFallback={<div className={styles.loading}>Loading staff…</div>}
      >
        <StaffInteractionOverlay
          orderedIds={orderedIds}
          selectedId={selectedId}
          onAdd={onAdd}
          onMove={onMove}
          onSelect={onSelect}
          onContentBounds={handleBounds}
        />
      </ScoreView>
    </div>
  );
}

interface OverlayProps {
  readonly orderedIds: readonly string[];
  readonly selectedId: string | null;
  readonly onAdd: (staffPosition: number) => void;
  readonly onMove: (id: string, staffPosition: number) => void;
  readonly onSelect: (id: string) => void;
  /** Report the music's content extent (display-list px) — vertical (top,
   *  bottom) for height crop, and the left/right edges for the horizontal
   *  crop + centering. */
  readonly onContentBounds: (top: number, bottom: number, left: number, right: number) => void;
}

interface DragState {
  id: string | null; // null = potential add on empty staff
  startX: number;
  startY: number;
  moved: boolean;
}

/**
 * Transparent pointer layer over the rendered slice. Uses `detectStaves` for
 * the staff geometry and a `SpatialIndex` of the display list for notehead
 * hit-testing, so no glyph/staff geometry is re-implemented here.
 */
function StaffInteractionOverlay({ orderedIds, selectedId, onAdd, onMove, onSelect, onContentBounds }: OverlayProps) {
  const { displayList, zoom, pagePositions } = useScoreView();
  const ref = useRef<HTMLDivElement | null>(null);
  const selCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const staff = useMemo(() => (displayList ? detectStaves(displayList)[0] : undefined), [displayList]);
  const index = useMemo(() => (displayList ? SpatialIndex.fromDisplayList(displayList) : null), [displayList]);
  const eventBoxes = useMemo<ElementBBox[]>(
    () => (index ? index.all.filter((e) => getElementType(e.id) === "event").sort((a, b) => a.x - b.x) : []),
    [index],
  );

  // Map each component id to its EVENT-level bbox by the bbox's last path
  // segment (the slice tags every event with `id = componentId`, so the bbox
  // is `…/{componentId}`). This is robust to layout (no positional x-index),
  // and naturally skips `…/n0` notehead bboxes whose last segment isn't a
  // component id.
  const componentIds = useMemo(() => new Set(orderedIds), [orderedIds]);
  const eventByComponent = useMemo(() => {
    const m = new Map<string, ElementBBox>();
    for (const b of eventBoxes) {
      const seg = b.id.split("/").pop();
      if (seg && componentIds.has(seg)) m.set(seg, b);
    }
    return m;
  }, [eventBoxes, componentIds]);

  // Report content bounds so the host crops the page margins: top/bottom for
  // the height, and the staff's left/right edges for the horizontal crop +
  // centering — an explicit pageWidth gives the slice a large fixed margin we
  // don't want.
  useEffect(() => {
    if (!staff) return;
    let top = staff.y;
    let bottom = staff.y + staff.height;
    let right = staff.xEnd;
    for (const b of eventBoxes) {
      top = Math.min(top, b.y);
      bottom = Math.max(bottom, b.y + b.height);
      right = Math.max(right, b.x + b.width);
    }
    onContentBounds(top, bottom, staff.x, right);
  }, [staff, eventBoxes, onContentBounds]);

  const page = pagePositions[0];

  // Paint the selection highlight using the SAME renderer the main score canvas
  // uses (paintSelectionOverlay) — no bespoke highlight geometry. We look up the
  // selected component's notehead-level element id (`{event}/n0`) by id, so it
  // gets the standard notehead ellipse; falling back to the event id.
  useEffect(() => {
    const canvas = selCanvasRef.current;
    if (!canvas || !page || !index) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.ceil(page.width * dpr);
    canvas.height = Math.ceil(page.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, page.width, page.height);
    if (!selectedId) return;
    const box = eventByComponent.get(selectedId);
    if (!box) return;
    const noteId = `${box.id}/n0`;
    const targetId = index.getBBox(noteId) ? noteId : box.id;
    // Display-list coords are unzoomed; the page canvas is drawn at `zoom`.
    ctx.scale(zoom, zoom);
    paintSelectionOverlay(ctx, index, new Set([targetId]));
  }, [page, index, selectedId, eventByComponent, zoom]);

  // Convert a pointer event to display-list coordinates (unzoomed).
  const toDl = useCallback(
    (e: ReactPointerEvent): { x: number; y: number } | null => {
      const el = ref.current;
      if (!el || zoom <= 0) return null;
      const rect = el.getBoundingClientRect();
      return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
    },
    [zoom],
  );

  // Which component's notehead is under this dl point? Maps by id, not x-index.
  const componentAt = useCallback(
    (dlX: number, dlY: number): string | null => {
      const pad = 6;
      for (const [compId, b] of eventByComponent) {
        if (dlX >= b.x - pad && dlX <= b.x + b.width + pad && dlY >= b.y - pad && dlY <= b.y + b.height + pad) {
          return compId;
        }
      }
      return null;
    },
    [eventByComponent],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent) => {
      const dl = toDl(e);
      if (!dl) return;
      ref.current?.setPointerCapture(e.pointerId);
      const id = componentAt(dl.x, dl.y);
      dragRef.current = { id, startX: dl.x, startY: dl.y, moved: false };
    },
    [toDl, componentAt],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !staff) return;
      const dl = toDl(e);
      if (!dl) return;
      if (!drag.moved && Math.abs(dl.x - drag.startX) + Math.abs(dl.y - drag.startY) < DRAG_THRESHOLD) return;
      drag.moved = true;
      // Only existing noteheads move; empty-staff drags do nothing until release.
      if (drag.id) onMove(drag.id, staffPositionFromDlY(dl.y, staff));
    },
    [toDl, staff, onMove],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      ref.current?.releasePointerCapture(e.pointerId);
      if (!drag || !staff) return;
      const dl = toDl(e);
      if (!dl) return;
      if (drag.id) {
        if (!drag.moved) onSelect(drag.id);
      } else if (!drag.moved) {
        // Click on empty staff → add a component at that position.
        onAdd(staffPositionFromDlY(dl.y, staff));
      }
    },
    [toDl, staff, onSelect, onAdd],
  );

  if (!page) return null;

  const overlayStyle: CSSProperties = {
    position: "absolute",
    left: page.x,
    top: page.y,
    width: page.width,
    height: page.height,
  };

  const selCanvasStyle: CSSProperties = {
    position: "absolute",
    left: page.x,
    top: page.y,
    width: page.width,
    height: page.height,
    pointerEvents: "none",
  };

  return (
    <>
      <canvas ref={selCanvasRef} style={selCanvasStyle} aria-hidden />
      <div
        ref={ref}
        className={styles.overlay}
        style={overlayStyle}
        role="application"
        aria-label="Percussion-map staff — click to add, drag a notehead to move"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </>
  );
}
