import type { MeasureBounds, SlurGeometry, RenderCommand } from "@viritura/renderer";
import { paintCommand, wasmComputeSlurPreview } from "@viritura/renderer";
import type { BarlineHit, EngraveAdornments } from "./ScoreCanvas";
import { PAPER_CREAM_FALLBACK } from "./paperPattern";
import { snappedSlurAnchorDelta, type SlurAnchorPoint } from "./slurAnchorSnap";
import {
  ENGRAVE_MARKER_SIZE,
  ENGRAVE_EYE_SIZE,
  markerCenterForMeasure,
  staffEyeCenter,
  deriveEngraveAnchors,
} from "./engraveAdornments";

/** Lucide-style 24×24 SVG paths for our two break glyphs.
 * Wrapped in `typeof` guards so the module can be imported in jsdom-based
 * tests where Path2D is undefined; the icons are only ever used by paint
 * code that runs against a real Canvas 2D context. */
const HAS_PATH2D = typeof Path2D !== "undefined";
const ICON_SYSTEM_BREAK = HAS_PATH2D
  ? new Path2D(
      // CornerDownLeft
      "M9 10 L4 15 L9 20 M20 4 v7 a4 4 0 0 1 -4 4 H4",
    )
  : (null as unknown as Path2D);
const ICON_PAGE_BREAK = HAS_PATH2D
  ? new Path2D(
      // FileDown (file with arrow pointing down inside)
      "M15 2 H6 a2 2 0 0 0 -2 2 v16 a2 2 0 0 0 2 2 h12 a2 2 0 0 0 2 -2 V7 Z " +
        "M14 2 v4 a2 2 0 0 0 2 2 h4 " +
        "M12 18 v-6 M9 15 l3 3 l3 -3",
    )
  : (null as unknown as Path2D);

/** Lucide Eye (open) — used for visible staves. */
const ICON_EYE_OPEN = HAS_PATH2D
  ? new Path2D(
      "M2 12 s3.5 -7 10 -7 s10 7 10 7 s-3.5 7 -10 7 s-10 -7 -10 -7 z " + "M12 9 a3 3 0 1 0 0 6 a3 3 0 1 0 0 -6 z",
    )
  : (null as unknown as Path2D);
/** Lucide EyeOff (closed/hidden) — used for ghost rails. */
const ICON_EYE_OFF = HAS_PATH2D
  ? new Path2D(
      "M9.88 5.09 A10.94 10.94 0 0 1 12 5 c6.5 0 10 7 10 7 a13.16 13.16 0 0 1 -1.67 2.68 " +
        "M6.61 6.61 A13.526 13.526 0 0 0 2 12 s3.5 7 10 7 a9.74 9.74 0 0 0 5.39 -1.61 " +
        "M14.12 14.12 a3 3 0 1 1 -4.24 -4.24 " +
        "M3 3 l18 18",
    )
  : (null as unknown as Path2D);
/** Lucide TriangleAlert — used for ghost rails when hidden music is present. */
const ICON_TRIANGLE_ALERT = HAS_PATH2D
  ? new Path2D(
      "M21.73 18 L13.73 4 a2 2 0 0 0 -3.46 0 L2.27 18 a2 2 0 0 0 1.73 3 H20 a2 2 0 0 0 1.73 -3 z " +
        "M12 9 v4 " +
        "M12 17 h0.01",
    )
  : (null as unknown as Path2D);

/** Linear-interpolate two RGBA colour tuples. Used for hover-fade colour
 *  transitions on engrave adornments (eye pills + ghost-rail pills). */
function lerpRgba(a: [number, number, number, number], b: [number, number, number, number], t: number): string {
  const tt = Math.max(0, Math.min(1, t));
  const r = Math.round(a[0] + (b[0] - a[0]) * tt);
  const g = Math.round(a[1] + (b[1] - a[1]) * tt);
  const bl = Math.round(a[2] + (b[2] - a[2]) * tt);
  const al = a[3] + (b[3] - a[3]) * tt;
  return `rgba(${r}, ${g}, ${bl}, ${al.toFixed(3)})`;
}

const EYE_VIS_BASE: [number, number, number, number] = [70, 80, 95, 0.92];
const EYE_VIS_HOVER: [number, number, number, number] = [110, 125, 145, 0.98];
const EYE_HID_BASE: [number, number, number, number] = [180, 110, 40, 0.95];
const EYE_HID_HOVER: [number, number, number, number] = [225, 145, 55, 1];
// Red: hidden staff(s) carry music — destructive, demands attention.
const RAIL_BASE: [number, number, number, number] = [220, 60, 60, 0.95];
const RAIL_HOVER: [number, number, number, number] = [245, 90, 90, 1];
const RAIL_PILL_BASE: [number, number, number, number] = [210, 50, 50, 0.95];
const RAIL_PILL_HOVER: [number, number, number, number] = [240, 80, 80, 1];
// Blue: hidden empty staff(s) — informational, safe to leave hidden.
const RAIL_BASE_EMPTY: [number, number, number, number] = [59, 130, 246, 0.95];
const RAIL_HOVER_EMPTY: [number, number, number, number] = [96, 165, 250, 1];
const RAIL_PILL_BASE_EMPTY: [number, number, number, number] = [37, 99, 235, 0.95];
const RAIL_PILL_HOVER_EMPTY: [number, number, number, number] = [59, 130, 246, 1];

/** Paint engrave-mode adornments: barline hover highlight + break markers + staff-eye pills. */
export interface EngraveAdornmentsPaintArgs {
  ctx: CanvasRenderingContext2D;
  measureBounds: MeasureBounds[] | undefined;
  hoverBarline: BarlineHit | null;
  adornments: EngraveAdornments | undefined;
  selectedMarkerId: string | null;
  partIdByIndex: readonly string[];
  pageMarginLeftPx: number;
  hoverEyeId: string | null;
  hoverGhostRailId: string | null;
  hoverFadeT: number;
  slurGeometries: SlurGeometry[] | undefined;
  slurHandleDrag: {
    elementId: string;
    handle: "p0" | "p1" | "p2" | "p3" | "pm";
    dxPx: number;
    dyPx: number;
    geom: SlurGeometry;
    sourceCommand: Extract<RenderCommand, { type: "DrawFilledBezier" }>;
  } | null;
  hoverSlurHandleKey: string | null;
  selectedSlurId: string | null;
  textExpressionDrag: {
    elementId: string;
    bbox: { x: number; y: number; width: number; height: number };
    commands: RenderCommand[];
    dxPx: number;
    dyPx: number;
  } | null;
}

// eslint-disable-next-line max-lines-per-function, max-statements, complexity -- sequential canvas painter for 8 engrave-mode adornment layers (barline hover ring, marker pills, staff-eyes, ghost rails, slur handles, drag preview, selection halo, hover cursor). Each layer is a few ctx.save/draw/restore calls keyed off the same args bundle; splitting per layer would multiply the args plumbing without sharing logic.
export function paintEngraveAdornments(args: EngraveAdornmentsPaintArgs): void {
  const {
    ctx,
    measureBounds,
    hoverBarline,
    adornments,
    selectedMarkerId,
    partIdByIndex,
    pageMarginLeftPx,
    hoverEyeId,
    hoverGhostRailId,
    hoverFadeT,
    slurGeometries,
    slurHandleDrag,
    hoverSlurHandleKey,
    selectedSlurId,
    textExpressionDrag,
  } = args;
  if (!measureBounds) return;

  // Barline hover highlight — bright vertical line over the right barline of
  // the hovered measure. Spans the entire system (top of topmost staff to
  // bottom of bottommost staff sharing this measure index), so the connector
  // between staves is highlighted too.
  if (hoverBarline) {
    let topY = Infinity;
    let bottomY = -Infinity;
    let xRef: number | null = null;
    for (const mb of measureBounds) {
      if (mb.index !== hoverBarline.measureIndex) continue;
      const right = mb.x + mb.width;
      if (Math.abs(right - hoverBarline.barlineX) > 1) continue;
      if (mb.y < topY) topY = mb.y;
      if (mb.y + mb.height > bottomY) bottomY = mb.y + mb.height;
      xRef = right;
    }
    if (xRef !== null && topY !== Infinity) {
      ctx.save();
      ctx.strokeStyle = "rgba(56, 132, 255, 0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(xRef, topY - 3);
      ctx.lineTo(xRef, bottomY + 3);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Break markers
  const markers = adornments?.markers ?? [];
  for (const mk of markers) {
    const c = markerCenterForMeasure(mk.measureIndex, measureBounds);
    if (!c) continue;
    const { cx, cy, topMb } = c;
    const r = ENGRAVE_MARKER_SIZE / 2;
    const isSelected = mk.id === selectedMarkerId;
    const fill = mk.kind === "page" ? "rgba(220, 90, 60, 0.95)" : "rgba(56, 132, 255, 0.95)";

    // Colored barline highlight — paint a vertical line over the right barline
    // of this measure spanning the full system, in the same colour as the
    // marker pill so the break is identifiable at a glance.
    {
      let topY = Infinity;
      let bottomY = -Infinity;
      const xRef = topMb.x + topMb.width;
      for (const mb of measureBounds) {
        if (mb.index !== mk.measureIndex) continue;
        if (Math.abs(mb.x + mb.width - xRef) > 1) continue;
        if (mb.y < topY) topY = mb.y;
        if (mb.y + mb.height > bottomY) bottomY = mb.y + mb.height;
      }
      if (topY !== Infinity) {
        ctx.save();
        ctx.strokeStyle = fill;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(xRef, topY - 2);
        ctx.lineTo(xRef, bottomY + 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.save();
    // Selection ring
    if (isSelected) {
      ctx.strokeStyle = "rgba(56, 132, 255, 0.95)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Pill background
    ctx.fillStyle = fill;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Lucide glyph (24×24 viewBox) drawn via Path2D, scaled to fit the pill.
    const glyph = mk.kind === "page" ? ICON_PAGE_BREAK : ICON_SYSTEM_BREAK;
    const glyphScale = (ENGRAVE_MARKER_SIZE * 0.62) / 24;
    ctx.translate(cx, cy);
    ctx.scale(glyphScale, glyphScale);
    ctx.translate(-12, -12);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2 / glyphScale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(glyph);
    ctx.restore();
  }

  // Staff-eye pills (left margin, per-staff per-system) — always painted.
  // Sized and styled to match the break markers for visual parity.
  // Eyes, the staff-measure index, and ghost rails are derived once per layout
  // (memoized on the measureBounds identity) so repaints and hover-fade frames
  // don't re-walk every (system, part).
  const anchors = deriveEngraveAnchors(
    measureBounds,
    partIdByIndex,
    adornments?.staffEyeProvider,
    adornments?.ghostRailGroupProvider,
    pageMarginLeftPx,
  );
  const eyes = anchors.eyes;
  const staffMeasureIndex = anchors.staffMeasureIndex;
  for (const eye of eyes) {
    const isVisibleStaff = eye.visible;
    const c = staffMeasureIndex ? staffEyeCenter(eye, staffMeasureIndex, pageMarginLeftPx) : null;
    if (!c) continue;
    const { cx, cy } = c;
    const r = ENGRAVE_EYE_SIZE / 2;
    const isHover = hoverEyeId === eye.id;
    const t = isHover ? hoverFadeT : 0;
    const pillFill = isVisibleStaff
      ? lerpRgba(EYE_VIS_BASE, EYE_VIS_HOVER, t)
      : lerpRgba(EYE_HID_BASE, EYE_HID_HOVER, t);
    ctx.save();
    ctx.fillStyle = pillFill;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const glyph = isVisibleStaff ? ICON_EYE_OPEN : ICON_EYE_OFF;
    const glyphScale = (ENGRAVE_EYE_SIZE * 0.62) / 24;
    ctx.translate(cx, cy);
    ctx.scale(glyphScale, glyphScale);
    ctx.translate(-12, -12);
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "transparent";
    ctx.lineWidth = 2 / glyphScale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke(glyph);
    ctx.restore();

    // Warning badge: small amber dot top-right when hidden music exists.
    if (!isVisibleStaff && eye.hasMusicHidden) {
      ctx.save();
      ctx.fillStyle = "rgba(245, 158, 11, 0.95)";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      const bx = cx + r * 0.7;
      const by = cy - r * 0.7;
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("!", bx, by + 0.5);
      ctx.restore();
    }
  }

  // Ghost rails — collapsed runs of consecutive hidden staves, drawn as a
  // red horizontal line across the system with a filled red pill containing
  // the EyeOff icon (matching the style of the eye pills). Multi-staff
  // rails add a small count badge at the top-right of the pill.
  const rails = anchors.rails;
  if (rails.length > 0) {
    const r = ENGRAVE_EYE_SIZE / 2;
    const glyphScale = (ENGRAVE_EYE_SIZE * 0.62) / 24;
    for (const rail of rails) {
      const isHover = hoverGhostRailId === rail.id;
      const t = isHover ? hoverFadeT : 0;
      // Red palette when *any* hidden staff in the rail carries music
      // (destructive — user likely wants to know). Blue palette when all
      // hidden staves are empty (informational). The warning triangle next
      // to the pill provides a non-color-dependent accessible indicator.
      const railBase = rail.hasMusicHidden ? RAIL_BASE : RAIL_BASE_EMPTY;
      const railHover = rail.hasMusicHidden ? RAIL_HOVER : RAIL_HOVER_EMPTY;
      const pillBase = rail.hasMusicHidden ? RAIL_PILL_BASE : RAIL_PILL_BASE_EMPTY;
      const pillHover = rail.hasMusicHidden ? RAIL_PILL_HOVER : RAIL_PILL_HOVER_EMPTY;
      const railColor = lerpRgba(railBase, railHover, t);
      const pillColor = lerpRgba(pillBase, pillHover, t);
      // Horizontal line
      ctx.save();
      ctx.strokeStyle = railColor;
      ctx.lineWidth = 2 + t * 0.5;
      ctx.beginPath();
      ctx.moveTo(rail.railLeftX, rail.cy);
      ctx.lineTo(rail.railRightX, rail.cy);
      ctx.stroke();
      ctx.restore();

      // Filled pill with EyeOff icon
      ctx.save();
      ctx.fillStyle = pillColor;
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(rail.cx, rail.cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.translate(rail.cx, rail.cy);
      ctx.scale(glyphScale, glyphScale);
      ctx.translate(-12, -12);
      ctx.strokeStyle = "#fff";
      ctx.fillStyle = "transparent";
      ctx.lineWidth = 2 / glyphScale;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(ICON_EYE_OFF);
      ctx.restore();

      // Accessible warning triangle when hidden music is present. Drawn
      // immediately to the right of the pill, inset on the rail line so it
      // sits visually attached to the affordance. Same red as the rail so
      // it's clearly part of the same warning.
      if (rail.hasMusicHidden) {
        const triSize = ENGRAVE_EYE_SIZE * 0.75;
        const triCx = rail.cx + r + triSize * 0.55;
        const triCy = rail.cy;
        const triScale = (triSize * 0.9) / 24;
        ctx.save();
        // White knockout so the rail line doesn't run through the triangle
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(triCx, triCy, triSize / 2 + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.translate(triCx, triCy);
        ctx.scale(triScale, triScale);
        ctx.translate(-12, -12);
        ctx.fillStyle = railColor;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5 / triScale;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.fill(ICON_TRIANGLE_ALERT);
        ctx.stroke(ICON_TRIANGLE_ALERT);
        ctx.restore();
      }

      // Count label: "N hidden" centered on the rail line for multi-staff
      // rails. The line is broken behind the text so it reads cleanly.
      // Single-staff rails omit the label (icon alone is unambiguous).
      if (rail.isMulti) {
        const label = `${rail.staffGroups.length} hidden`;
        const labelCx = (rail.railLeftX + rail.railRightX) / 2;
        const labelCy = rail.cy;
        ctx.save();
        ctx.font = "600 14px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const textW = ctx.measureText(label).width;
        const pad = 6;
        // Clear the line behind the label
        ctx.fillStyle = "#fff";
        ctx.fillRect(labelCx - textW / 2 - pad, labelCy - 9, textW + pad * 2, 18);
        ctx.fillStyle = railColor;
        ctx.fillText(label, labelCx, labelCy);
        ctx.restore();
      }
    }
  }

  // Slur bezier handles. Only the *selected* slur exposes its spine cubic
  // (p0, p1, p2, p3) as drag handles — unselected slurs render no overlay so
  // the engrave view stays uncluttered. The engine-published `SlurGeometry`
  // is already in layout coordinates, so we can paint directly.
  if (slurGeometries && slurGeometries.length > 0 && selectedSlurId) {
    const sel = slurGeometries.find((g) => g.elementId === selectedSlurId);
    if (sel) paintSlurHandles(ctx, [sel], slurHandleDrag, hoverSlurHandleKey);
  }

  // Text-expression live drag: occlude the element's original ink with a paper
  // patch, then redraw its actual text commands translated by the in-progress
  // drag so the real text follows the cursor (mirrors the slur drag preview).
  // Element bboxes hug the text tightly, so the occlusion patch covers little
  // beyond the text itself.
  if (textExpressionDrag) {
    const { bbox, commands, dxPx, dyPx } = textExpressionDrag;
    const pad = 1.5;
    ctx.save();
    // Occlude the original at its laid-out position.
    ctx.fillStyle = PAPER_CREAM_FALLBACK;
    ctx.fillRect(bbox.x - pad, bbox.y - pad, bbox.width + pad * 2, bbox.height + pad * 2);
    // Redraw the real text translated to the drag position.
    ctx.translate(dxPx, dyPx);
    for (const cmd of commands) paintCommand(ctx, cmd);
    ctx.restore();
    // Subtle destination outline so the new anchor reads clearly.
    ctx.save();
    ctx.strokeStyle = "rgba(33, 94, 78, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(bbox.x - pad + dxPx, bbox.y - pad + dyPx, bbox.width + pad * 2, bbox.height + pad * 2);
    ctx.restore();
  }
}

/** Visible radius for endpoint (p0/p3) handles. */
const SLUR_HANDLE_END_R = 4.5;
/** Visible radius for control-point (p1/p2) handles. */
const SLUR_HANDLE_CP_R = 4;

function paintSlurHandles(
  ctx: CanvasRenderingContext2D,
  slurGeometries: readonly SlurGeometry[],
  drag: {
    elementId: string;
    handle: "p0" | "p1" | "p2" | "p3" | "pm";
    dxPx: number;
    dyPx: number;
    geom: SlurGeometry;
    sourceCommand: Extract<RenderCommand, { type: "DrawFilledBezier" }>;
  } | null,
  hoverKey: string | null,
  endpointsOnly = false,
): void {
  ctx.save();
  for (const g of slurGeometries) {
    const isDragged = drag?.elementId === g.elementId;
    const dx = isDragged ? drag!.dxPx : 0;
    const dy = isDragged ? drag!.dyPx : 0;
    const preview = isDragged
      ? wasmComputeSlurPreview({
          spine: [
            [g.p0x, g.p0y],
            [g.p1x, g.p1y],
            [g.p2x, g.p2y],
            [g.p3x, g.p3y],
          ],
          thickness: g.thickness,
          endpointThickness: Math.hypot(
            drag!.sourceCommand.x1 - drag!.sourceCommand.ix1,
            drag!.sourceCommand.y1 - drag!.sourceCommand.iy1,
          ),
          curveDir: g.curveDir,
          lineStyle: drag!.sourceCommand.line_style,
          mode: endpointsOnly ? "write" : "engrave",
          handle: drag!.handle,
          dx,
          dy,
        })
      : null;
    const spine = preview?.spine ?? [
      [g.p0x, g.p0y],
      [g.p1x, g.p1y],
      [g.p2x, g.p2y],
      [g.p3x, g.p3y],
    ];
    const [[p0x, p0y], [p1x, p1y], [p2x, p2y], [p3x, p3y]] = spine;
    // Midpoint of the (possibly drag-previewed) cubic at t = 0.5.
    const pmx = (p0x + 3 * p1x + 3 * p2x + p3x) / 8;
    const pmy = (p0y + 3 * p1y + 3 * p2y + p3y) / 8;

    if (!endpointsOnly) {
      // Tangent guide lines from endpoints to their control points.
      ctx.strokeStyle = "rgba(56, 132, 255, 0.55)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(p0x, p0y);
      ctx.lineTo(p1x, p1y);
      ctx.moveTo(p3x, p3y);
      ctx.lineTo(p2x, p2y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (preview) {
      paintCommand(ctx, { ...preview.command, color: "rgba(56, 132, 255, 0.9)" });
    }

    // Handle dots.
    const drawHandle = (h: "p0" | "p1" | "p2" | "p3" | "pm", x: number, y: number, r: number, isCp: boolean) => {
      const key = `${g.elementId}::${h}`;
      const isHover = hoverKey === key;
      const isThisDragged = isDragged && drag!.handle === h;
      ctx.beginPath();
      ctx.arc(x, y, isHover || isThisDragged ? r + 1.5 : r, 0, Math.PI * 2);
      ctx.fillStyle = isCp
        ? isHover || isThisDragged
          ? "rgba(56, 132, 255, 1)"
          : "rgba(56, 132, 255, 0.95)"
        : isHover || isThisDragged
          ? "rgba(255, 255, 255, 1)"
          : "rgba(255, 255, 255, 0.98)";
      ctx.strokeStyle = "rgba(56, 132, 255, 1)";
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    };
    drawHandle("p0", p0x, p0y, SLUR_HANDLE_END_R, false);
    drawHandle("p3", p3x, p3y, SLUR_HANDLE_END_R, false);
    if (!endpointsOnly) {
      drawHandle("p1", p1x, p1y, SLUR_HANDLE_CP_R, true);
      drawHandle("p2", p2x, p2y, SLUR_HANDLE_CP_R, true);
      // Midpoint handle — Illustrator-style "drag the curve itself". Slightly
      // larger than the bezier CP dots so it reads as the primary shaping target.
      drawHandle("pm", pmx, pmy, SLUR_HANDLE_CP_R + 1, false);
    }
  }
  ctx.restore();
}

/** Paint only note-reanchoring endpoint handles for a slur selected in Write mode. */
export function paintWriteSlurHandles(
  ctx: CanvasRenderingContext2D,
  slurGeometries: readonly SlurGeometry[] | undefined,
  selectedSlurId: string,
  drag:
    | (NonNullable<EngraveAdornmentsPaintArgs["slurHandleDrag"]> & {
        startEngineX: number;
        startEngineY: number;
        anchor?: {
          end: "start" | "end";
          points: SlurAnchorPoint[];
          dragX: number;
          dragY: number;
        };
      })
    | null,
  hoverKey: string | null,
): void {
  const selected = slurGeometries?.find((geometry) => geometry.elementId === selectedSlurId);
  if (!selected) return;
  let previewDrag = drag;
  if (drag?.anchor) {
    const segments = drag.elementId.split("/");
    const currentEventId = drag.anchor.end === "start" ? segments[1] : segments[2];
    const delta = currentEventId
      ? snappedSlurAnchorDelta(drag.anchor.points, currentEventId, drag.anchor.dragX, drag.anchor.dragY)
      : null;
    if (delta) previewDrag = { ...drag, dxPx: delta.dx, dyPx: delta.dy };
  }
  paintSlurHandles(ctx, [selected], previewDrag, hoverKey, true);
}
