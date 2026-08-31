/**
 * Layout Debug Painter — draws the vertical-spacing debug overlay onto the
 * score canvas. Operates in the same coordinate space as `paintCommand`
 * (i.e. inside the viewport transform), so X/Y match the engine's pixel
 * coordinates.
 */

import type { DisplayList, LayoutDebugInfo, SystemDebug } from "@viritura/renderer";
import type { LayoutDebugCategories } from "./layoutDebugStore";

/**
 * Rendered element bbox as emitted by the layout engine (nested
 * `{ elementId, bbox }` shape). Derived from `DisplayList.elementBboxes` so it
 * stays in lock-step with the engine output rather than the flat hit-test
 * `ElementBBox` (id/x/y/width/height) exported from the renderer barrel.
 */
type ElementBBox = NonNullable<DisplayList["elementBboxes"]>[number];

const COLOR_BBOX = "rgba(0, 200, 220, 0.85)";
const COLOR_BBOX_FILL = "rgba(0, 200, 220, 0.05)";
const COLOR_STAFF_TOP = "rgba(40, 200, 90, 0.9)";
const COLOR_STAFF_BOTTOM = "rgba(220, 70, 70, 0.9)";
const COLOR_ABOVE_FILL = "rgba(255, 210, 60, 0.18)";
const COLOR_BELOW_FILL = "rgba(255, 130, 50, 0.18)";
const COLOR_HIGHEST = "rgba(220, 60, 220, 0.95)";
const COLOR_LOWEST = "rgba(140, 80, 220, 0.95)";
const COLOR_INTER_GAP = "rgba(40, 130, 240, 0.9)";
const COLOR_STAFF_PAIR = "rgba(20, 200, 200, 0.9)";
const COLOR_LABEL_BG = "rgba(20, 24, 32, 0.85)";
const COLOR_LABEL_FG = "#FFFFFF";

// ── Note-spacing palette ──
// Compression bar colours (scale = justified/natural)
const COLOR_SCALE_TIGHT = "rgba(230, 70, 70, 0.55)"; // scale << 1
const COLOR_SCALE_NATURAL = "rgba(80, 200, 120, 0.55)"; // scale ~ 1
const COLOR_SCALE_STRETCH = "rgba(70, 140, 240, 0.55)"; // scale >> 1
const COLOR_EVENT_TICK = "rgba(255, 255, 255, 0.65)";
const COLOR_EVENT_TICK_FLOOR = "rgba(230, 70, 70, 1.0)"; // gap hit min_note_spacing

// ── Placement-box palette (§0/§1 keep-out field) ──
// Two nested boxes, both built from the same tight ink bound:
const COLOR_PLACEMENT_INK = "rgba(0, 220, 180, 0.95)"; // 1. true tight bound
const COLOR_PLACEMENT_COLLISION = "rgba(255, 90, 200, 0.95)"; // 2. collision boundary (tight + per-type pad)
// attach_gap / clearance visualization. When a dependent is LIFTED above its
// default `attachGap` (i.e. it had to clear an obstacle), draw a translucent
// band of height `padding.vertical` (the clearance it keeps from the nearest
// ink) emanating from its ink edge toward the obstacle. Its far edge should
// land exactly on the obstacle's ink — that is the "1sp from the nearest ink"
// the placement promises. When the element sits at its default `attachGap` from
// the staff (nothing to clear), nothing is drawn.
const COLOR_CLEARANCE_FILL = "rgba(255, 80, 80, 0.30)"; // clearance band to nearest ink
const COLOR_CLEARANCE_LINE = "rgba(220, 40, 40, 0.95)"; // far edge: expected nearest-ink line

export interface PaintLayoutDebugOpts {
  categories: LayoutDebugCategories;
  /** Optional X offset to add to all engine coordinates (e.g., spread page X). */
  offsetX?: number;
  /** Optional Y offset to add to all engine coordinates (e.g., spread page Y - yOffset). */
  offsetY?: number;
  /** Current zoom — used to keep stroke widths visually consistent. */
  zoom: number;
  /**
   * Rendered element bounding boxes (absolute engine coords). When provided,
   * the per-measure extreme lines are derived from the TRUE rendered extent
   * of every element in a measure (notehead glyph edges, accidentals,
   * articulations, dynamics, …) instead of the engine's note/stem-only
   * protrusion estimate. Falls back to `SystemDebug.measureExtremes` when
   * absent or when no boxes fall inside a measure.
   */
  elementBboxes?: ElementBBox[];
  /**
   * Visible world rect in **engine coordinates** (i.e. already offset by
   * `-offsetX/-offsetY` for the page this call paints). When supplied, the
   * overlay culls systems and element boxes to this rect before its heavy
   * per-box passes. Without it the painter walks every system and every box in
   * the score on every frame — O(boxes²) in `paintAttachGap` — which hangs the
   * main thread on large orchestral scores.
   */
  visible?: { minX: number; minY: number; maxX: number; maxY: number };
}

export function paintLayoutDebug(
  ctx: CanvasRenderingContext2D,
  debug: LayoutDebugInfo,
  opts: PaintLayoutDebugOpts,
): void {
  const dx = opts.offsetX ?? 0;
  const dy = opts.offsetY ?? 0;
  const px = 1 / Math.max(opts.zoom, 0.01); // ~1 device px in score units
  const sp = debug.sp;

  // Viewport cull. The overlay's per-box passes are O(boxes) and the
  // attach-gap nearest-ink scan is O(boxes²), so on a large orchestral score
  // (~100K element boxes) painting the whole score every frame hangs the main
  // thread for seconds. Restrict every heavy pass to the boxes/systems that
  // actually intersect the visible rect (expanded by a small margin so the
  // attach-gap viz of a box near the viewport edge still finds its nearest
  // ink). The margin is in engine units; attach gaps are only a few `sp`.
  const vis = opts.visible;
  const margin = 8 * sp;
  const systems =
    vis != null
      ? debug.systems.filter((s) => s.bboxBottomY >= vis.minY - margin && s.bboxTopY <= vis.maxY + margin)
      : debug.systems;
  const allBoxes = opts.elementBboxes;
  const boxes =
    vis != null && allBoxes
      ? allBoxes.filter((b) => {
          const { x, y, width, height } = b.bbox;
          return (
            x + width >= vis.minX - margin &&
            x <= vis.maxX + margin &&
            y + height >= vis.minY - margin &&
            y <= vis.maxY + margin
          );
        })
      : allBoxes;

  // Bucket element boxes by the system whose band contains their vertical
  // centre — computed once so per-measure extreme refinement stays cheap.
  const boxesBySystem = opts.categories.measureExtremes ? bucketBoxesBySystem(systems, boxes) : null;

  ctx.save();
  ctx.translate(dx, dy);

  for (const sys of systems) {
    paintSystem(ctx, sys, debug, opts.categories, px, sp, boxesBySystem?.get(sys.index));
  }

  if (opts.categories.placementBoxes && debug.placement && boxes) {
    paintPlacementBoxes(ctx, debug, opts.categories, px, boxes, systems);
  }
  ctx.restore();
}

/**
 * Map an element id to its placement-table key (`dynamic`, `expression`, …) or
 * `null` when it is not a dependent the overlay covers. Mirrors the engine's
 * `classify_element_kind` suffix logic, restricted to the dependent kinds whose
 * `attach_gap` is measured from the **staff** (so the gold/red attach-gap bands
 * are meaningful). Articulations are deliberately excluded: they are dependents
 * too, but **note-attached** — their `attach_gap` is a clearance from the
 * notehead/stem, not the staff — so a staff-relative band would be misleading.
 * Uses the real `element_id` constructors (e.g. dynamics are `…/dyn{n}`,
 * expressions `…/expr{n}`).
 */
function placementKeyForId(id: string): string | null {
  const last = id.slice(id.lastIndexOf("/") + 1);
  // Terminal-suffix kinds (exact last segment).
  if (last === "fermata") return "fermata";
  // Articulations (staccato/accent/…) are note-attached, not staff-relative;
  // their attach_gap is a clearance from the notehead/stem, so the staff-based
  // attach-gap band does not apply. Excluded from the overlay.
  if (last === "artic" || last.startsWith("artic")) return null;
  if (last === "ornament") return "ornament";
  if (last === "trill") return "trill";
  if (last === "segno") return "segno";
  if (last === "coda") return "coda";
  if (last === "fine") return "fine";
  if (last === "jump") return "jump";
  if (last === "rehearsal") return "rehearsalMark";
  if (last === "mnum") return "measureNumber";
  // Indexed-suffix kinds (prefix of the last segment).
  if (last.startsWith("dyn")) return "dynamic";
  if (last.startsWith("expr")) return "expression";
  if (last.startsWith("tempo")) return "tempo";
  if (last.startsWith("chord")) return "chordSymbol";
  if (id.includes("lyric")) return "lyric";
  return null;
}

/**
 * Draw each dependent element's keep-out geometry as two nested boxes, both
 * built from the same **true tight ink bound** (the engine's `elementBboxes`
 * entry, which is the SMuFL glyph extent for text/dynamics):
 *
 * 1. **Tight bound** (teal, solid) — the raw ink extent, box 1.
 * 2. **Collision boundary** (magenta, dashed) — tight + **half** the
 *    per-element-type padding from the active `PlacementTable`: `sideBearing/2`
 *    horizontally and `stackGap/2` vertically.
 *
 * The half-padding matters: the engine's keep-out test
 * (`dependent_stacking::horizontally_shares_column`) collapses adjacent margins
 * to `max(sb_a, sb_b)` (CSS-style), it does **not** sum them. Drawing each box's
 * *full* bearing would make two perfectly-clear neighbours' halos overlap and
 * read as a false collision. Drawing half the bearing per box makes two boxes
 * that are exactly `max(sb)` apart meet edge-to-edge (when their bearings are
 * equal), so visual contact == real contact.
 *
 * `attachGap` is the default clearance from the staff. Three stacked pieces are
 * drawn from the staff toward the element's ink edge, on every dependent: a
 * **dotted border** from the staff to the 2sp default-margin line (the default
 * reserve), a **solid border** from that margin to the nearest in-column ink in
 * the lift zone (skipped when nothing protrudes past the margin), and a
 * translucent **red box** from that ink (or the margin) to the element's ink
 * edge (the spare padding — verifies ink hitboxes; a thin sliver when the
 * element is at its default gap). All distances resolve to pixels in the
 * sidecar.
 */
function paintPlacementBoxes(
  ctx: CanvasRenderingContext2D,
  debug: LayoutDebugInfo,
  cats: LayoutDebugCategories,
  px: number,
  boxes: ElementBBox[],
  systems: SystemDebug[],
) {
  const placement = debug.placement;
  if (!placement) return;

  for (const b of boxes) {
    const key = placementKeyForId(b.elementId);
    if (!key) continue;
    const m = placement[key];
    if (!m) continue;

    const { x, y, width, height } = b.bbox;

    // 2. Collision boundary: tight bound + HALF the per-type padding
    //    (sideBearing/2 horizontal, stackGap/2 vertical), because the engine
    //    collapses adjacent margins to max() rather than summing — so half a
    //    bearing per box makes two collapsed neighbours meet edge-to-edge
    //    instead of overlapping. Drawn first/outermost so the tighter box reads
    //    on top.
    const halfSb = m.sideBearing / 2;
    const halfSg = m.stackGap / 2;
    const cx = x - halfSb;
    const cy = y - halfSg;
    const cw = width + 2 * halfSb;
    const ch = height + 2 * halfSg;
    ctx.strokeStyle = COLOR_PLACEMENT_COLLISION;
    ctx.lineWidth = px * 1.4;
    ctx.setLineDash([5 * px, 3 * px]);
    ctx.strokeRect(cx, cy, cw, ch);
    ctx.setLineDash([]);

    // 1. True tightest bound (ink extent).
    ctx.strokeStyle = COLOR_PLACEMENT_INK;
    ctx.lineWidth = px * 1.2;
    ctx.strokeRect(x, y, width, height);

    // Lift visualization: when the element sits past its default attach gap,
    // show (a) the actual distance to the nearest ink below it, (b) the lift
    // zone down to the 2sp default margin, and (c) the default margin down to
    // the staff. Scans all rendered boxes to find the nearest ink in-column.
    const actualGap = paintAttachGap(ctx, b.bbox, b.elementId, m.attachGapAbove, m.attachGapBelow, systems, boxes, px);

    if (cats.labels) {
      const actualStr = actualGap === null ? "?" : actualGap.toFixed(0);
      const label = `${key} ag:${m.attachGap.toFixed(0)}→${actualStr} sg:${m.stackGap.toFixed(0)} sb:${m.sideBearing.toFixed(0)} r:${m.stackRank}`;
      paintPlacementLabel(ctx, label, cx, cy, px);
    }
  }
}

/**
 * Draw the attach-gap visualization for a dependent. Three stacked zones,
 * stacked from the staff up to the element's nearest ink edge — always drawn
 * (lifted or not), so the default reserve is visible on every marking:
 *
 *   1. **Dotted border** (innermost, nearest the staff) — the default
 *      attach-gap reserve: staff → 2sp default-margin line.
 *   2. **Solid border** (middle) — the protruding-ink zone: 2sp margin → the
 *      NEAREST INK within the element's column (a notehead, accidental,
 *      articulation, MMR count number, …), but ONLY counting ink that lives in
 *      the lift zone (farther from the staff than the 2sp margin). Skipped when
 *      no ink protrudes past the margin (the common, un-lifted case).
 *   3. **Translucent red box** (outermost, against the element) — the spare
 *      padding: the nearest constraint (protruding-ink top, or the margin when
 *      nothing protrudes) → the element's ink edge. Its height is the true
 *      clearance the element keeps above its nearest constraint, so you can
 *      confirm ink hitboxes are accurate. When no ink is in the lift zone (e.g.
 *      a tempo aligned to a rehearsal mark, with only a low notehead nearby),
 *      the red box stops at the 2sp margin and reads as pure "extra lift" — it
 *      never reaches into the staff. For a default-positioned element it is a
 *      thin sliver (the nominal-half-em vs tight-ink slack).
 *
 * Returns the actual measured gap from the staff in pixels (or `null` when no
 * containing system or the box straddles the staff, so the caller can label it).
 */
function resolveSystemForBox(systems: SystemDebug[], cyBox: number): SystemDebug | undefined {
  const exact = systems.find((s) => cyBox >= s.bboxTopY && cyBox <= s.bboxBottomY);
  if (exact) return exact;
  // Fall back to the nearest system band (distance 0 if inside).
  let best: SystemDebug | undefined;
  let bestDist = Infinity;
  for (const s of systems) {
    const d = cyBox < s.bboxTopY ? s.bboxTopY - cyBox : cyBox > s.bboxBottomY ? cyBox - s.bboxBottomY : 0;
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

function paintAttachGap(
  ctx: CanvasRenderingContext2D,
  box: ElementBBox["bbox"],
  selfId: string,
  attachGapAbove: number,
  attachGapBelow: number,
  systems: SystemDebug[],
  boxes: ElementBBox[],
  px: number,
): number | null {
  const { x, y, width, height } = box;
  const cyBox = y + height / 2;
  // The system this box belongs to. Normally the band `[bboxTopY, bboxBottomY]`
  // contains the box's vertical centre. But an element lifted ABOVE its system's
  // reserved above-staff extent (e.g. a tempo hoisted over a tall obstacle the
  // system frame under-reserved) has its centre above `bboxTopY`, so exact
  // containment fails — and the old early-return drew NOTHING, leaving such an
  // element with no attach-gap context at all (the exact "no red box / no dotted
  // reserve" the lifted tempo showed). Fall back to the nearest system band so
  // the three-zone viz still draws: the red box then reveals what the element
  // is actually clearing.
  const sys = resolveSystemForBox(systems, cyBox);
  if (!sys) return null;

  // Above-staff (ink centre above the top line) vs below-staff (below the
  // bottom line). A box straddling the staff has no single anchor line.
  let staffLine: number;
  let nearEdge: number; // the element's actual nearest ink edge (faces the staff)
  let sign: number; // -1 above the staff, +1 below it
  if (cyBox < sys.staffTopY) {
    staffLine = sys.staffTopY;
    sign = -1;
    nearEdge = y + height; // ink bottom faces the staff below
  } else if (cyBox > sys.staffBottomY) {
    staffLine = sys.staffBottomY;
    sign = +1;
    nearEdge = y; // ink top faces the staff above
  } else {
    return null;
  }

  const actualGap = Math.abs(staffLine - nearEdge);

  // The default-reserve gap is the kind's staff-datum reserve for THIS side of
  // the staff. The engine stores per-side reserves (an above-staff expression
  // rests ~1sp off the staff, the same kind below rests ~3sp clearing the
  // dynamics line), so the overlay picks the side the box is actually on. This
  // makes the dotted reserve + red spare-padding match the gap the engine
  // applied, instead of drawing a phantom reserve from the wrong side.
  const defaultGap = sign < 0 ? attachGapAbove : attachGapBelow;

  // The three markers are drawn for EVERY dependent, lifted or not, so the
  // default attach-gap reserve is always visible. A default-positioned element
  // reads as a dotted reserve (height = the kind's default gap) with a thin red
  // spare-padding sliver against it (the sliver is the nominal-half-em vs
  // tight-ink-bbox slack — the gap is anchored on the text's nominal half-em,
  // while `nearEdge` is the tight ink edge, so a few px of "padding" always
  // shows). A lifted element adds the solid protruding-ink band and a taller
  // red box.

  // The element's edge at its default gap from the staff, CLAMPED so the
  // reserve never extends past the element's own near edge. A baseline-anchored
  // below-staff glyph rests closer to the staff than its nominal edge gap: a
  // dynamic's 3sp `attachGap` is measured to its BASELINE, but the glyph ink
  // top (the edge facing the staff) sits ~1.8sp closer. Without the clamp the
  // default-margin line lands *past* the glyph, and the red spare-padding box
  // inverts back across the ink (the wrong, oversized red box). Clamping to the
  // actual gap collapses the visualization to a pure dotted reserve whenever
  // the element sits at/within its default — the correct reading — and only
  // grows the solid + red bands once the element is genuinely lifted past it.
  const reserveGap = Math.min(defaultGap, actualGap);
  const marginEdge = staffLine + sign * reserveGap;

  // Nearest ink in-column, on the staff side of the element's edge. For an
  // above-staff element we look down (obstacle top edges below `nearEdge`); for
  // a below-staff element we look up (obstacle bottom edges above `nearEdge`).
  const eps = 0.5 * px;
  let nearestInk: number | null = null;
  for (const ob of boxes) {
    if (ob.elementId === selfId) continue;
    const ob_x = ob.bbox.x;
    const ob_w = ob.bbox.width;
    if (ob_x + ob_w < x - eps || ob_x > x + width + eps) continue; // no x-overlap
    const facing = sign < 0 ? ob.bbox.y : ob.bbox.y + ob.bbox.height;
    const onStaffSide = sign < 0 ? facing > nearEdge + eps : facing < nearEdge - eps;
    if (!onStaffSide) continue;
    if (nearestInk === null) nearestInk = facing;
    else nearestInk = sign < 0 ? Math.min(nearestInk, facing) : Math.max(nearestInk, facing);
  }

  // Boundary between the spare-padding zone (red) and the protruding-ink zone
  // (solid): the nearest ink, but only when it protrudes past the 2sp margin on
  // the FAR side from the staff (i.e. into the lift zone). `sign * (ink −
  // margin) > eps` holds only when the ink is beyond the margin in the lift
  // direction — a notehead sitting within the staff (on the staff side of the
  // margin) fails it and is ignored, so an element lifted for a reason OTHER
  // than that ink (e.g. a tempo aligned to a rehearsal mark, with the staff's
  // own notes nearby) reads as pure "extra lift" capped at the margin instead
  // of the red box plunging down to a note inside the staff.
  const inkInLiftZone = nearestInk !== null && sign * (nearestInk - marginEdge) > eps;
  const inkBoundary = inkInLiftZone ? (nearestInk as number) : marginEdge;

  // 3. Dotted border: staff → 2sp default margin (the default attach reserve).
  ctx.strokeStyle = COLOR_CLEARANCE_LINE;
  ctx.lineWidth = px * 1.2;
  ctx.setLineDash([2 * px, 2 * px]);
  ctx.strokeRect(x, Math.min(staffLine, marginEdge), width, Math.abs(marginEdge - staffLine));
  ctx.setLineDash([]);

  // 2. Solid border: 2sp margin → protruding-ink top (ink living in the lift
  //    zone). Skipped when no ink protrudes past the margin.
  if (Math.abs(inkBoundary - marginEdge) > eps) {
    ctx.lineWidth = px * 1.4;
    ctx.strokeRect(x, Math.min(marginEdge, inkBoundary), width, Math.abs(inkBoundary - marginEdge));
  }

  // 1. Translucent red box: protruding-ink top (or margin) → element ink edge.
  //    The spare padding the element keeps above its nearest constraint.
  ctx.fillStyle = COLOR_CLEARANCE_FILL;
  ctx.fillRect(x, Math.min(inkBoundary, nearEdge), width, Math.abs(nearEdge - inkBoundary));

  return actualGap;
}

function paintPlacementLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number) {
  const fontPx = 9 * px;
  ctx.font = `${fontPx}px ui-monospace, monospace`;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  const padX = 3 * px;
  const w = ctx.measureText(text).width + 2 * padX;
  const h = fontPx + 3 * px;
  ctx.fillStyle = COLOR_LABEL_BG;
  ctx.fillRect(x, y - h, w, h);
  ctx.fillStyle = COLOR_LABEL_FG;
  ctx.fillText(text, x + padX, y - 1.5 * px);
}

/**
 * Assign each element box to the system whose `[bboxTopY, bboxBottomY]` band
 * contains the box's vertical centre. Systems never overlap vertically (the
 * positioner keeps `min_skyline_clearance` between adjacent bboxes), so the
 * assignment is unambiguous. Returns null when no boxes were supplied.
 */
function bucketBoxesBySystem(
  systems: SystemDebug[],
  boxes: ElementBBox[] | undefined,
): Map<number, ElementBBox[]> | null {
  if (!boxes || boxes.length === 0) return null;
  const sorted = [...systems].sort((a, b) => a.bboxTopY - b.bboxTopY);
  const out = new Map<number, ElementBBox[]>();
  for (const b of boxes) {
    const cy = b.bbox.y + b.bbox.height / 2;
    // Linear scan is fine: debug overlay only, and systems-per-page is small.
    for (const s of sorted) {
      if (cy >= s.bboxTopY && cy <= s.bboxBottomY) {
        const list = out.get(s.index);
        if (list) list.push(b);
        else out.set(s.index, [b]);
        break;
      }
    }
  }
  return out;
}

function paintSystem(
  ctx: CanvasRenderingContext2D,
  s: SystemDebug,
  debug: LayoutDebugInfo,
  cats: LayoutDebugCategories,
  px: number,
  sp: number,
  systemBoxes: ElementBBox[] | undefined,
) {
  if (cats.aboveBelowExtras) paintAboveBelowExtras(ctx, s);
  if (cats.systemBboxes) paintSystemBbox(ctx, s, px);
  if (cats.staffLines) paintStaffLines(ctx, s, px);
  if (cats.measureExtremes) paintMeasureExtremes(ctx, s, px, systemBoxes);
  if (cats.interSystemGaps && s.interSystemGapToNext) {
    paintInterSystemGap(ctx, s, cats.labels, px, sp);
  }
  if (cats.staffPairGaps && s.staffPairs.length > 0) {
    paintStaffPairGaps(ctx, s, cats.labels, px, sp);
  }
  if (cats.noteSpacing && s.measureSpacings && s.measureSpacings.length > 0) {
    paintNoteSpacing(ctx, s, debug, cats, px, sp);
  }
  if (cats.labels) paintSystemInfoBadge(ctx, s, px, sp);
}

function paintAboveBelowExtras(ctx: CanvasRenderingContext2D, s: SystemDebug) {
  const w = s.xEnd - s.xStart;
  if (s.aboveExtra > 0) {
    ctx.fillStyle = COLOR_ABOVE_FILL;
    ctx.fillRect(s.xStart, s.bboxTopY, w, s.aboveExtra);
  }
  if (s.belowExtra > 0) {
    ctx.fillStyle = COLOR_BELOW_FILL;
    ctx.fillRect(s.xStart, s.staffBottomY, w, s.belowExtra);
  }
}

function paintSystemBbox(ctx: CanvasRenderingContext2D, s: SystemDebug, px: number) {
  const w = s.xEnd - s.xStart;
  const h = s.bboxBottomY - s.bboxTopY;
  ctx.fillStyle = COLOR_BBOX_FILL;
  ctx.fillRect(s.xStart, s.bboxTopY, w, h);
  ctx.strokeStyle = COLOR_BBOX;
  ctx.lineWidth = px * 1.2;
  ctx.setLineDash([6 * px, 4 * px]);
  ctx.strokeRect(s.xStart, s.bboxTopY, w, h);
  ctx.setLineDash([]);
}

function paintStaffLines(ctx: CanvasRenderingContext2D, s: SystemDebug, px: number) {
  ctx.lineWidth = px * 1.5;
  ctx.strokeStyle = COLOR_STAFF_TOP;
  ctx.beginPath();
  ctx.moveTo(s.xStart, s.staffTopY);
  ctx.lineTo(s.xEnd, s.staffTopY);
  ctx.stroke();
  ctx.strokeStyle = COLOR_STAFF_BOTTOM;
  ctx.beginPath();
  ctx.moveTo(s.xStart, s.staffBottomY);
  ctx.lineTo(s.xEnd, s.staffBottomY);
  ctx.stroke();
}

function paintMeasureExtremes(
  ctx: CanvasRenderingContext2D,
  s: SystemDebug,
  px: number,
  systemBoxes: ElementBBox[] | undefined,
) {
  for (const m of s.measureExtremes) {
    // Default: engine note/stem-only protrusion (staff-relative; <0 = above).
    let highestY = s.staffTopY + m.highestPoint;
    let lowestY = s.staffTopY + m.lowestPoint;

    // Preferred: TRUE rendered extent from element boxes that fall inside this
    // measure's horizontal span. Captures notehead glyph edges, accidentals,
    // articulations, dynamics, etc. — everything the protrusion estimate omits.
    if (systemBoxes) {
      let top = Infinity;
      let bottom = -Infinity;
      for (const b of systemBoxes) {
        const bx0 = b.bbox.x;
        const bx1 = b.bbox.x + b.bbox.width;
        // Horizontal overlap with [xStart, xEnd]; measures are x-contiguous so
        // each box maps to exactly one measure.
        if (bx1 < m.xStart || bx0 > m.xEnd) continue;
        if (b.bbox.y < top) top = b.bbox.y;
        if (b.bbox.y + b.bbox.height > bottom) bottom = b.bbox.y + b.bbox.height;
      }
      if (Number.isFinite(top)) {
        // Never report tighter than the staff itself.
        highestY = Math.min(top, s.staffTopY);
        lowestY = Math.max(bottom, s.staffBottomY);
      }
    }

    ctx.lineWidth = px;
    ctx.strokeStyle = COLOR_HIGHEST;
    ctx.beginPath();
    ctx.moveTo(m.xStart, highestY);
    ctx.lineTo(m.xEnd, highestY);
    ctx.stroke();
    ctx.strokeStyle = COLOR_LOWEST;
    ctx.beginPath();
    ctx.moveTo(m.xStart, lowestY);
    ctx.lineTo(m.xEnd, lowestY);
    ctx.stroke();
  }
}

function paintInterSystemGap(
  ctx: CanvasRenderingContext2D,
  s: SystemDebug,
  showLabels: boolean,
  px: number,
  sp: number,
) {
  const gap = s.interSystemGapToNext!;
  const x = s.xStart + 12 * px;
  const y0 = s.bboxBottomY;
  const y1 = y0 + gap.actualGap;
  drawVerticalBrace(ctx, x, y0, y1, COLOR_INTER_GAP, px);
  if (showLabels) {
    const txt = `gap ${(gap.actualGap / sp).toFixed(2)}sp${gap.justified ? " (justified)" : ""}`;
    drawLabel(ctx, x + 8 * px, (y0 + y1) / 2, txt, px);
  }
}

function paintStaffPairGaps(
  ctx: CanvasRenderingContext2D,
  s: SystemDebug,
  showLabels: boolean,
  px: number,
  sp: number,
) {
  for (const sp_ of s.staffPairs) {
    const x = s.xEnd - 12 * px;
    drawVerticalBrace(ctx, x, sp_.upperStaffBottomY, sp_.lowerStaffTopY, COLOR_STAFF_PAIR, px);
    if (showLabels) {
      const j = (sp_.justifiedGap / sp).toFixed(2);
      const c = (sp_.contentGap / sp).toFixed(2);
      const a = (sp_.actualGap / sp).toFixed(2);
      const txt = `j=${j} c=${c} → ${a}sp`;
      drawLabel(ctx, x - 8 * px, (sp_.upperStaffBottomY + sp_.lowerStaffTopY) / 2, txt, px, "right");
    }
  }
}

function paintSystemInfoBadge(ctx: CanvasRenderingContext2D, s: SystemDebug, px: number, sp: number) {
  const pieces: string[] = [];
  pieces.push(`sys ${s.index}`);
  pieces.push(`p${s.pageIndex}`);
  pieces.push(`above ${(s.aboveExtra / sp).toFixed(2)}sp`);
  pieces.push(`below ${(s.belowExtra / sp).toFixed(2)}sp`);
  const ab = s.aboveBreakdown;
  const flags: string[] = [];
  if (ab.hasTempo) flags.push("T");
  if (ab.hasRehearsal) flags.push("R");
  if (ab.hasJump) flags.push("J");
  const bb = s.belowBreakdown;
  if (bb.hasDynamics) flags.push("d");
  if (bb.hasLyrics) flags.push("l");
  if (bb.hasPedals) flags.push("p");
  if (flags.length) pieces.push(`[${flags.join("")}]`);
  drawLabel(ctx, s.xStart + 4 * px, s.bboxTopY + 12 * px, pieces.join(" · "), px);
}

function paintNoteSpacing(
  ctx: CanvasRenderingContext2D,
  s: SystemDebug,
  debug: LayoutDebugInfo,
  cats: LayoutDebugCategories,
  px: number,
  sp: number,
) {
  const minNoteSpacing = debug.minNoteSpacing || 0;
  const shortestSp = debug.shortestDurationSpace || 0;
  // Compression bar sits just below the staff (above other below-staff decorations).
  // Make it 6 device px tall so it's visible across zoom levels.
  const barH = 6 * px;
  const barY = s.staffBottomY + 2 * px;
  // Tick line extends from the staff top down through the bar.
  const tickY0 = s.staffTopY;
  const tickY1 = barY + barH;

  for (const m of s.measureSpacings) {
    const w = m.xEnd - m.xStart;
    if (w <= 0) continue;

    // ── Compression bar (colour by scale) ──
    const scale = m.scale;
    let barColor: string;
    if (scale < 0.95) barColor = COLOR_SCALE_TIGHT;
    else if (scale > 1.05) barColor = COLOR_SCALE_STRETCH;
    else barColor = COLOR_SCALE_NATURAL;
    ctx.fillStyle = barColor;
    ctx.fillRect(m.xStart, barY, w, barH);

    // ── Per-event ticks ──
    // Compare each gap to min_note_spacing — colour red if at/under floor (+5% tolerance).
    const xs = m.eventXs;
    const floor = minNoteSpacing * 1.05;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      if (x === undefined) continue;
      // Determine if gap to next is at-floor.
      let atFloor = false;
      const next = xs[i + 1];
      if (next !== undefined) {
        const gap = next - x;
        if (minNoteSpacing > 0 && gap <= floor) atFloor = true;
      }
      ctx.strokeStyle = atFloor ? COLOR_EVENT_TICK_FLOOR : COLOR_EVENT_TICK;
      ctx.lineWidth = atFloor ? px * 1.4 : px;
      ctx.beginPath();
      ctx.moveTo(x, tickY0);
      ctx.lineTo(x, tickY1);
      ctx.stroke();
    }

    // ── Per-measure label (compact stats) ──
    if (cats.labels && w > 40 * px) {
      const pieces: string[] = [];
      pieces.push(`m${m.measureIndex}`);
      pieces.push(formatCompression(scale));
      if (m.minGap > 0) pieces.push(`min ${(m.minGap / sp).toFixed(2)}sp`);
      if (m.maxGap > 0) pieces.push(`max ${(m.maxGap / sp).toFixed(2)}sp`);
      drawLabel(ctx, m.xStart + 2 * px, barY + barH + 8 * px, pieces.join(" "), px);
    }
  }

  // ── System-level compression badge (above the staff, near right edge) ──
  if (cats.labels) {
    const naturalTotal = s.measureSpacings.reduce((a, m) => a + m.naturalWidth, 0);
    const justifiedTotal = s.xEnd - s.xStart;
    const sysScale = naturalTotal > 0 ? justifiedTotal / naturalTotal : 1;
    const txt =
      `sys ${formatCompression(sysScale)}` +
      ` · min ${(minNoteSpacing / sp).toFixed(2)}sp` +
      ` · pref ${(shortestSp / sp).toFixed(2)}sp`;
    drawLabel(ctx, s.xEnd - 4 * px, barY + barH + 8 * px, txt, px, "right");
    // Prominent badge above the staff: e.g. "−18%  (compressed)".
    drawLabel(ctx, s.xEnd - 4 * px, s.staffTopY - 8 * px, formatCompressionVerbose(sysScale), px, "right");
  }
}

/** Compact compression label, e.g. "−18%" (compressed), "+12%" (stretched), "100%" (natural). */
function formatCompression(scale: number): string {
  const pct = Math.round((scale - 1) * 100);
  if (pct === 0) return "100%";
  const sign = pct > 0 ? "+" : "−";
  return `${sign}${Math.abs(pct)}%`;
}

/** Verbose compression label for the system-level badge. */
function formatCompressionVerbose(scale: number): string {
  const pct = Math.round((scale - 1) * 100);
  if (pct === 0) return "compression 0% (natural)";
  if (pct < 0) return `compression ${pct}% (compressed → ${(scale * 100).toFixed(0)}% of natural)`;
  return `compression +${pct}% (stretched → ${(scale * 100).toFixed(0)}% of natural)`;
}

function drawVerticalBrace(
  ctx: CanvasRenderingContext2D,
  x: number,
  y0: number,
  y1: number,
  color: string,
  px: number,
) {
  if (y1 <= y0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = px * 1.2;
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  // end caps
  const cap = 4 * px;
  ctx.beginPath();
  ctx.moveTo(x - cap, y0);
  ctx.lineTo(x + cap, y0);
  ctx.moveTo(x - cap, y1);
  ctx.lineTo(x + cap, y1);
  ctx.stroke();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  px: number,
  align: "left" | "right" = "left",
) {
  const fontSize = 10 * px;
  ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = align;
  const metrics = ctx.measureText(text);
  const padX = 4 * px;
  const padY = 2 * px;
  const w = metrics.width + padX * 2;
  const h = fontSize + padY * 2;
  const bgX = align === "left" ? x - padX : x - w + padX;
  ctx.fillStyle = COLOR_LABEL_BG;
  ctx.fillRect(bgX, y - h / 2, w, h);
  ctx.fillStyle = COLOR_LABEL_FG;
  ctx.fillText(text, x, y);
  ctx.textAlign = "left"; // reset
}
