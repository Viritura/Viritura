/**
 * Overlay Painter — renders input cursor and ghost note preview
 * on top of the score canvas without re-running WASM layout.
 *
 * All coordinates are in display-list (score) space.
 * The caller applies the viewport transform before calling these functions.
 */

import type { DisplayList } from "./wasm";

type ContentPointSnapper = (x: number, y: number) => { x: number; y: number };

// ─── SMuFL Notehead Codepoints ──────────────────────────
const NOTEHEAD_WHOLE = 0xe0a2;
const NOTEHEAD_HALF = 0xe0a3;
const NOTEHEAD_BLACK = 0xe0a4;

// ─── Accidental Codepoints ──────────────────────────────
const ACCIDENTAL_FLAT = 0xe260;
const ACCIDENTAL_NATURAL = 0xe261;
const ACCIDENTAL_SHARP = 0xe262;
const ACCIDENTAL_DOUBLE_SHARP = 0xe263;
const ACCIDENTAL_DOUBLE_FLAT = 0xe264;

/** A detected staff region in score coordinates. */
export interface StaffInfo {
  /** X coordinate of the left edge of the staff. */
  x: number;
  /** X coordinate of the right edge of the staff. */
  xEnd: number;
  /** Y coordinate of the top staff line. */
  y: number;
  /** Distance between adjacent staff lines (spatium). */
  spatium: number;
  /** Total height of the 5-line staff (4 × spatium). */
  height: number;
  /** 0-based index of this staff in the detected staves list (top to bottom). */
  index: number;
}

/**
 * Extract staff regions from a display list by detecting groups of 5
 * horizontal lines with consistent spacing (staff lines).
 *
 * Staff lines are thin horizontal DrawLine commands with the same x1/x2
 * range and evenly spaced y values.
 */
export function detectStaves(displayList: DisplayList): StaffInfo[] {
  // Collect long horizontal lines along with their stroke width. The engine
  // draws staff lines at `0.13 * spatium` px thick, so a fixed absolute
  // thinness cutoff breaks at large spatium (e.g. an A3 score at spatium 19.5px
  // has 2.5px-thick staff lines). We therefore keep a generous absolute ceiling
  // here only to drop obviously-thick strokes, and do the real thinness test
  // *relative to the detected staff spacing* inside the grouping pass below.
  const hLines: Array<{ x1: number; x2: number; y: number; width: number }> = [];
  for (const cmd of displayList.commands) {
    if (cmd.type === "DrawLine" && Math.abs(cmd.y1 - cmd.y2) < 0.1 && cmd.width < 8.0) {
      const x1 = Math.min(cmd.x1, cmd.x2);
      const x2 = Math.max(cmd.x1, cmd.x2);
      // Only consider lines long enough to be staff lines (not ledger lines).
      // Staff lines span the full system width (hundreds of pixels).
      // Ledger lines are ~2 spatiums wide (~24px at sp=12).
      if (x2 - x1 > 50) {
        hLines.push({ x1, x2, y: cmd.y1, width: cmd.width });
      }
    }
  }

  if (hLines.length < 5) return [];

  // Sort by x1, then y
  hLines.sort((a, b) => a.x1 - b.x1 || a.y - b.y);

  // Group lines by similar x1/x2 range (tolerance 1px)
  const groups: Array<{ x1: number; x2: number; lines: Array<{ y: number; width: number }> }> = [];
  for (const line of hLines) {
    let matched = false;
    for (const group of groups) {
      if (Math.abs(group.x1 - line.x1) < 1.5 && Math.abs(group.x2 - line.x2) < 1.5) {
        group.lines.push({ y: line.y, width: line.width });
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.push({ x1: line.x1, x2: line.x2, lines: [{ y: line.y, width: line.width }] });
    }
  }

  // Filter groups that have at least 5 lines (a staff)
  const staves: StaffInfo[] = [];
  for (const group of groups) {
    if (group.lines.length < 5) continue;

    // Sort by Y and look for sets of 5 with consistent spacing
    group.lines.sort((a, b) => a.y - b.y);
    const ys = group.lines.map((l) => l.y);
    const widths = group.lines.map((l) => l.width);

    for (let i = 0; i <= ys.length - 5; i++) {
      const window = ys.slice(i, i + 5);
      const spacing = (window[4]! - window[0]!) / 4;
      if (spacing < 1) continue;

      // Reject unreasonable spatium values. Real staff spaces are ~6–48 pixels
      // (spatiumMm 0.5–4mm at 12 px/mm). Larger values come from ledger lines
      // across multiple systems being detected as a "staff" when their x extents
      // coincide.
      if (spacing > 48) continue;

      // Verify consistent spacing (tolerance 10%)
      let consistent = true;
      for (let j = 1; j < 5; j++) {
        const gap = window[j]! - window[j - 1]!;
        if (Math.abs(gap - spacing) > spacing * 0.1) {
          consistent = false;
          break;
        }
      }
      if (!consistent) continue;

      // Thinness relative to spacing: staff lines are ~0.13 spatium thick,
      // beams ~0.5 spatium. Require every line in the set to be thinner than
      // 0.35 spatium so beams / brackets that happen to align never register as
      // a staff. This replaces the old fixed `width < 2.0` px cutoff, which
      // rejected legitimate staff lines at large spatium.
      const maxWidth = spacing * 0.35;
      let thin = true;
      for (let j = i; j < i + 5; j++) {
        if (widths[j]! > maxWidth) {
          thin = false;
          break;
        }
      }
      if (!thin) continue;

      staves.push({
        x: group.x1,
        xEnd: group.x2,
        y: window[0]!,
        spatium: spacing,
        height: window[4]! - window[0]!,
        index: staves.length,
      });
      // Skip the 5 lines we just consumed
      i += 4;
    }
  }

  return staves;
}

/**
 * Derive unique physical staff rows for stitched Horizon. Every render chunk
 * repeats five staff-line commands, so generic detection returns
 * `chunks × staves`. Measure bounds already carry stable flattened staff IDs
 * and exact row geometry, avoiding the full command sort and duplicate rows.
 */
export function detectHorizonStaves(displayList: DisplayList): StaffInfo[] {
  const bounds = displayList.measureBounds;
  if (!bounds?.length) return detectStaves(displayList);

  const rows = new Map<number, { x: number; xEnd: number; y: number; height: number }>();
  for (const bound of bounds) {
    if (bound.isHidden) continue;
    const xEnd = bound.x + bound.width;
    const row = rows.get(bound.staffIndex);
    if (row) {
      row.x = Math.min(row.x, bound.x);
      row.xEnd = Math.max(row.xEnd, xEnd);
      row.y = Math.min(row.y, bound.y);
      row.height = Math.max(row.height, bound.height);
    } else {
      rows.set(bound.staffIndex, { x: bound.x, xEnd, y: bound.y, height: bound.height });
    }
  }

  return [...rows.values()]
    .sort((left, right) => left.y - right.y)
    .map((row, index) => ({
      x: row.x,
      xEnd: row.xEnd,
      y: row.y,
      spatium: row.height / 4,
      height: row.height,
      index,
    }));
}

/**
 * Find the staff closest to a given Y position in score coordinates.
 * Returns null if no staff is within a reasonable range.
 */
export function findStaffAtPosition(staves: StaffInfo[], scoreX: number, scoreY: number): StaffInfo | null {
  let best: StaffInfo | null = null;
  let bestDist = Infinity;

  for (const staff of staves) {
    // Check X is within staff bounds (with some margin)
    if (scoreX < staff.x - staff.spatium || scoreX > staff.xEnd + staff.spatium) {
      continue;
    }
    // Vertical distance to staff center
    const staffCenter = staff.y + staff.height / 2;
    const dist = Math.abs(scoreY - staffCenter);
    // Allow clicking up to 3 spatiums above/below staff
    if (dist < staff.height / 2 + staff.spatium * 3 && dist < bestDist) {
      bestDist = dist;
      best = staff;
    }
  }

  return best;
}

/**
 * Snap a Y coordinate to the nearest staff line or space.
 * Returns the snapped Y in score coordinates.
 *
 * Staff positions are at half-spatium intervals:
 * - Lines: y, y + sp, y + 2sp, y + 3sp, y + 4sp
 * - Spaces: y + 0.5sp, y + 1.5sp, y + 2.5sp, y + 3.5sp
 * - Ledger lines above/below: y - sp, y - 0.5sp, y + 5sp, y + 4.5sp, etc.
 */
export function snapToStaffPosition(scoreY: number, staff: StaffInfo): number {
  const halfSp = staff.spatium / 2;
  // Distance from top line in half-spatiums
  const relY = scoreY - staff.y;
  const halfSteps = Math.round(relY / halfSp);
  return staff.y + halfSteps * halfSp;
}

/**
 * Get the staff line index for a snapped Y position.
 * 0 = top line (index from top), increments by 0.5 for spaces.
 * Negative = above staff, >4 = below staff.
 */
export function getStaffPosition(snappedY: number, staff: StaffInfo): number {
  return (snappedY - staff.y) / staff.spatium;
}

/**
 * Get the SMuFL notehead codepoint for a given duration.
 */
export function noteheadForDuration(duration: string): number {
  switch (duration) {
    case "1":
      return NOTEHEAD_WHOLE;
    case "2":
      return NOTEHEAD_HALF;
    default:
      return NOTEHEAD_BLACK;
  }
}

/**
 * Get the SMuFL accidental codepoint.
 */
function accidentalCodepoint(accidental: string | null): number | null {
  switch (accidental) {
    case "sharp":
      return ACCIDENTAL_SHARP;
    case "flat":
      return ACCIDENTAL_FLAT;
    case "natural":
      return ACCIDENTAL_NATURAL;
    case "double-sharp":
      return ACCIDENTAL_DOUBLE_SHARP;
    case "double-flat":
      return ACCIDENTAL_DOUBLE_FLAT;
    default:
      return null;
  }
}

/** Options for painting the ghost note overlay. */
export interface GhostNoteOptions {
  /** Snapped Y position in score coordinates. */
  y: number;
  /** X position in score coordinates (cursor position). */
  x: number;
  /** The staff this ghost note is on. */
  staff: StaffInfo;
  /** Note duration string ("1", "2", "4", "8", etc.). */
  duration: string;
  /** Accidental to show (null = none). */
  accidental: string | null;
  /** Whether to show a rest instead. */
  isRest: boolean;
}

/**
 * Paint the input cursor (thin blue vertical line) at a given X position.
 */
export function paintInputCursor(ctx: CanvasRenderingContext2D, x: number, staff: StaffInfo): void {
  const margin = staff.spatium * 0.5;
  ctx.save();
  ctx.strokeStyle = "rgba(33, 150, 243, 0.85)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, staff.y - margin);
  ctx.lineTo(x, staff.y + staff.height + margin);
  ctx.stroke();
  ctx.restore();
}

/**
 * Paint a ghost note preview on the overlay canvas.
 * Draws a semi-transparent notehead at the snapped position,
 * with ledger lines if needed, and an optional accidental.
 */
export function paintGhostNote(ctx: CanvasRenderingContext2D, opts: GhostNoteOptions): void {
  if (opts.isRest) return;

  const { y, x, staff, duration, accidental } = opts;
  const sp = staff.spatium;
  const fontSize = sp * 4;

  ctx.save();
  ctx.globalAlpha = 0.35;

  // Draw notehead glyph
  const codepoint = noteheadForDuration(duration);
  ctx.fillStyle = "rgba(33, 150, 243, 1)";
  ctx.font = `${fontSize}px Bravura`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String.fromCodePoint(codepoint), x, y);

  // Draw ledger lines if note is above or below the staff
  const staffPos = getStaffPosition(y, staff);
  paintLedgerLines(ctx, x, y, staffPos, staff);

  // Draw accidental if set
  const accCode = accidentalCodepoint(accidental);
  if (accCode !== null) {
    const accX = x - sp * 1.2;
    ctx.fillText(String.fromCodePoint(accCode), accX, y);
  }

  ctx.restore();
}

/**
 * Draw ledger lines for positions above or below the staff.
 */
function paintLedgerLines(
  ctx: CanvasRenderingContext2D,
  noteX: number,
  noteY: number,
  staffPos: number,
  staff: StaffInfo,
): void {
  const sp = staff.spatium;
  const ledgerWidth = sp * 1.6;
  const ledgerX = noteX - sp * 0.3;

  ctx.strokeStyle = "rgba(33, 150, 243, 1)";
  ctx.lineWidth = 1.2;

  // Ledger lines above staff (staffPos < 0)
  if (staffPos < 0) {
    const topLedger = Math.ceil(staffPos);
    for (let pos = -1; pos >= topLedger; pos--) {
      const ly = staff.y + pos * sp;
      ctx.beginPath();
      ctx.moveTo(ledgerX, ly);
      ctx.lineTo(ledgerX + ledgerWidth, ly);
      ctx.stroke();
    }
  }

  // Ledger lines below staff (staffPos > 4)
  if (staffPos > 4) {
    const bottomLedger = Math.floor(staffPos);
    for (let pos = 5; pos <= bottomLedger; pos++) {
      const ly = staff.y + pos * sp;
      ctx.beginPath();
      ctx.moveTo(ledgerX, ly);
      ctx.lineTo(ledgerX + ledgerWidth, ly);
      ctx.stroke();
    }
  }
}

export { NOTEHEAD_WHOLE, NOTEHEAD_HALF, NOTEHEAD_BLACK };

// ─── SMuFL Clef Codepoint Range ─────────────────────────
// Clefs occupy U+E050–U+E07F in SMuFL
const CLEF_RANGE_MIN = 0xe050;
const CLEF_RANGE_MAX = 0xe07f;

function isClefCodepoint(cp: number): boolean {
  return cp >= CLEF_RANGE_MIN && cp <= CLEF_RANGE_MAX;
}

/** Per-staff clef and label info extracted from a display list. */
export interface StickyClefInfo {
  /** Staff index (parallel to detectStaves result). */
  staffIndex: number;
  /**
   * All clefs found on this staff's row, sorted by ascending x. Includes the
   * initial clef plus any mid-staff clef changes. In stitched-horizon mode the
   * same staff is rendered in chunks that each repeat the active clef, so this
   * list can contain several entries with the same codepoint at increasing x.
   * The painter shows only the one in effect at the current scroll position.
   */
  clefs: Array<{ x: number; y: number; codepoint: number; size: number; color: string }>;
  /** Staff label text command, if found. */
  label: { x: number; y: number; text: string; font: string; size: number; align: string; baseline: string } | null;
}

/**
 * Extract per-staff clef and label info from a display list.
 * For each staff, collects every clef glyph that sits on the staff's row
 * (the initial clef and any mid-staff clef changes), plus the label text
 * that appears near the staff's left edge.
 */
export function extractStickyClefInfo(displayList: DisplayList, staves: StaffInfo[]): StickyClefInfo[] {
  if (staves.length === 0) return [];

  const result: StickyClefInfo[] = staves.map((_, i) => ({
    staffIndex: i,
    clefs: [],
    label: null,
  }));

  for (const cmd of displayList.commands) {
    if (cmd.type === "DrawGlyph" && isClefCodepoint(cmd.codepoint)) {
      // Match the clef to its staff by Y proximity only. We deliberately do NOT
      // restrict to the staff's left edge: a staff may carry mid-staff clef
      // changes (and, in stitched-horizon mode, repeated clefs at each chunk
      // seam) that all belong to this row. Matching by Y and breaking on the
      // first hit funnels every clef on a physical row into a single staff
      // entry, so duplicate per-chunk staff segments don't each accumulate a
      // clef in the sticky overlay.
      for (let si = 0; si < staves.length; si++) {
        const staff = staves[si]!;
        if (cmd.y >= staff.y - staff.spatium * 2 && cmd.y <= staff.y + staff.height + staff.spatium * 2) {
          result[si]!.clefs.push({
            x: cmd.x,
            y: cmd.y,
            codepoint: cmd.codepoint,
            size: cmd.size,
            color: cmd.color,
          });
          break;
        }
      }
    } else if (cmd.type === "DrawText" && cmd.font === "serif") {
      // Staff labels are rendered in serif font to the left of the staff
      for (let si = 0; si < staves.length; si++) {
        const staff = staves[si]!;
        if (
          cmd.y >= staff.y - staff.spatium * 2 &&
          cmd.y <= staff.y + staff.height + staff.spatium * 2 &&
          cmd.x < staff.x + staff.spatium * 2
        ) {
          if (!result[si]!.label) {
            result[si]!.label = {
              x: cmd.x,
              y: cmd.y,
              text: cmd.text,
              font: cmd.font,
              size: cmd.size,
              align: cmd.align,
              baseline: cmd.baseline,
            };
          }
          break;
        }
      }
    }
  }

  // Sort each staff's clefs left-to-right so the painter can pick the most
  // recent one (the last clef whose x is at or before the scroll position).
  for (const info of result) {
    info.clefs.sort((a, b) => a.x - b.x);
  }

  return result;
}

/**
 * Paint sticky clefs and staff labels at the left edge of the viewport.
 * Designed for horizon view where horizontal scrolling can move the initial
 * clef/label off-screen. Mirrors Dorico's sticky clef behavior.
 *
 * Call this AFTER the main content is painted. The caller should set the
 * context transform to content-space before calling.
 *
 * @param ctx Canvas 2D context (in content-space transform)
 * @param staves Detected staff regions from detectStaves()
 * @param stickyInfo Per-staff clef/label info from extractStickyClefInfo()
 * @param scrollX Current horizontal scroll position in content-space
 * @param zoom Current zoom level
 * @param viewportWidth Viewport width in CSS pixels
 * @param leftInsetPx Safe-area left inset in CSS pixels (sticky column
 *   is offset by this so it lands flush with the visible region rather
 *   than at the canvas left edge — clears floating side panels).
 */
function paintStickyStaffLines(
  ctx: CanvasRenderingContext2D,
  staff: StaffInfo,
  stickyX: number,
  stickyWidth: number,
  snapContentPoint: ContentPointSnapper | undefined,
): void {
  const sp = staff.spatium;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 0.13 * sp;
  for (let line = 0; line < 5; line++) {
    const rawY = staff.y + line * sp;
    const p0 = snapContentPoint ? snapContentPoint(stickyX, rawY) : { x: stickyX, y: rawY };
    const p1 = snapContentPoint ? snapContentPoint(stickyX + stickyWidth, rawY) : { x: stickyX + stickyWidth, y: rawY };
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
}

function paintStickyClefGlyph(
  ctx: CanvasRenderingContext2D,
  clef: StickyClefInfo["clefs"][number],
  staff: StaffInfo,
  stickyX: number,
  renderSize: number,
  snapContentPoint: ContentPointSnapper | undefined,
): void {
  const sp = staff.spatium;
  const clefX = stickyX + sp * 0.3;
  const clefYOffset = clef.y - staff.y;
  const clefPoint = snapContentPoint
    ? snapContentPoint(clefX, staff.y + clefYOffset)
    : { x: clefX, y: staff.y + clefYOffset };
  ctx.fillStyle = "#000000";
  // Render at the full clef size, not the glyph's own `size`. A mid-staff clef
  // CHANGE is engraved smaller (cue-sized), but the sticky overlay shows the
  // clef in effect as the staff's primary clef, so it must match the initial
  // clef's full size. The clef baseline (`clef.y`) sits on the same reference
  // staff line regardless of size, so scaling around it keeps it anchored.
  ctx.font = `${renderSize}px Bravura`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(String.fromCodePoint(clef.codepoint), clefPoint.x, clefPoint.y);
}

function paintStickyStaffLabel(
  ctx: CanvasRenderingContext2D,
  label: NonNullable<StickyClefInfo["label"]>,
  staff: StaffInfo,
  stickyX: number,
  clefWidth: number,
  snapContentPoint: ContentPointSnapper | undefined,
  paperFill: string | CanvasPattern,
): void {
  const sp = staff.spatium;
  const labelSize = label.size * 0.75;
  // Offset label to the right of the clef so they don't overlap
  const labelX = stickyX + clefWidth;
  const labelY = staff.y - sp * 0.6;
  const labelPoint = snapContentPoint ? snapContentPoint(labelX, labelY) : { x: labelX, y: labelY };
  ctx.font = `${labelSize}px ${label.font}`;
  // Measure text to draw paper background
  const metrics = ctx.measureText(label.text);
  const pad = sp * 0.2;
  const ascent = metrics.actualBoundingBoxAscent ?? labelSize * 0.8;
  ctx.fillStyle = paperFill;
  ctx.fillRect(labelPoint.x - pad, labelPoint.y - ascent - pad, metrics.width + pad * 2, ascent + pad * 2);
  // Draw text
  ctx.fillStyle = "#555555";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(label.text, labelPoint.x, labelPoint.y);
}

/**
 * Pick the clef in effect at a given content-space x: the last clef in the
 * (x-sorted) list whose x is at or before `contentX`. Falls back to the first
 * clef when every clef is to the right of `contentX`.
 */
function pickActiveClef(clefs: StickyClefInfo["clefs"], contentX: number): StickyClefInfo["clefs"][number] {
  let chosen = clefs[0]!;
  for (const c of clefs) {
    if (c.x <= contentX) chosen = c;
    else break;
  }
  return chosen;
}

export function paintStickyClefs(
  ctx: CanvasRenderingContext2D,
  staves: StaffInfo[],
  stickyInfo: StickyClefInfo[],
  scrollX: number,
  zoom: number,
  leftInsetPx: number = 0,
  paperFill: string | CanvasPattern = "#FFFFFF",
  snapContentPoint?: ContentPointSnapper,
): void {
  if (staves.length === 0 || stickyInfo.length === 0) return;

  const leftInsetContent = leftInsetPx / zoom;
  const contentLeftEdge = scrollX + leftInsetContent;

  // Check if any staff has its initial clef scrolled off — if not, skip entirely
  let anyActive = false;
  const sp0 = staves[0]!.spatium;
  const minScrollThreshold = 2; // spatiums past the original clef
  for (let si = 0; si < staves.length; si++) {
    const firstClef = stickyInfo[si]?.clefs[0];
    if (firstClef && contentLeftEdge >= firstClef.x + sp0 * minScrollThreshold) {
      anyActive = true;
      break;
    }
  }
  if (!anyActive) return;

  // Determine sticky column width — just enough for the clef
  const clefWidth = sp0 * 3.5;
  const stickyWidth = clefWidth;

  // Paint paper rectangle covering only the staff region (first staff top to last staff bottom),
  // with a small margin for labels above and notes below.
  const firstStaff = staves[0]!;
  const lastStaff = staves[staves.length - 1]!;
  const labelMargin = sp0 * 1.5; // space for staff labels above
  const belowMargin = sp0 * 2; // space for notes/ledger lines below
  const bgTop = firstStaff.y - labelMargin;
  const bgBottom = lastStaff.y + lastStaff.height + belowMargin;
  const bgLeft = contentLeftEdge;

  ctx.fillStyle = paperFill;
  ctx.fillRect(bgLeft, bgTop, stickyWidth, bgBottom - bgTop);

  // Now paint per-staff content on top of the white strip
  for (let si = 0; si < staves.length; si++) {
    const staff = staves[si]!;
    const info = stickyInfo[si];
    if (!info) continue;
    const sp = staff.spatium;

    const clefs = info.clefs;
    if (clefs.length === 0) continue;

    const firstClef = clefs[0]!;
    // Only show sticky elements for staves whose initial clef has scrolled off
    if (contentLeftEdge < firstClef.x + sp * minScrollThreshold) continue;

    // Show the clef in EFFECT at the scroll position: the most recent clef
    // whose x is at or before the visible left edge. Earlier clefs (including
    // repeated per-chunk copies in stitched-horizon mode) are superseded, so
    // they no longer pile up — only the current clef is drawn.
    const clef = pickActiveClef(clefs, contentLeftEdge);

    const stickyX = contentLeftEdge;

    // The initial clef is always engraved at full size; use it as the render
    // size so a smaller mid-staff clef change still shows full-sized here.
    const fullClefSize = firstClef.size;

    paintStickyStaffLines(ctx, staff, stickyX, stickyWidth, snapContentPoint);
    paintStickyClefGlyph(ctx, clef, staff, stickyX, fullClefSize, snapContentPoint);

    // Draw the staff label above the clef (standard) with paper background
    const label = info.label;
    if (label) {
      paintStickyStaffLabel(ctx, label, staff, stickyX, clefWidth, snapContentPoint, paperFill);
    }
  }
}

/**
 * Paint a sticky measure number above the top staff at the left edge
 * of the viewport. Shows which measure is currently at the scroll position.
 */
export function paintMeasureNumber(
  ctx: CanvasRenderingContext2D,
  staves: StaffInfo[],
  measureBounds: ReadonlyArray<{ index: number; x: number; width: number; partIndex: number }>,
  scrollX: number,
  zoom: number,
  leftInsetPx: number = 0,
  paperFill: string | CanvasPattern = "#FFFFFF",
): void {
  if (staves.length === 0 || measureBounds.length === 0) return;

  const contentX = scrollX + leftInsetPx / zoom;

  // Find the measure whose bounds contain the current scroll position (partIndex=0 row)
  let currentMeasureIndex = 0;
  for (const mb of measureBounds) {
    if (mb.partIndex !== 0) continue;
    if (contentX >= mb.x && contentX < mb.x + mb.width) {
      currentMeasureIndex = mb.index;
      break;
    }
    if (mb.x + mb.width > contentX) {
      currentMeasureIndex = mb.index;
      break;
    }
  }

  const staff = staves[0]!;
  const sp = staff.spatium;
  const text = String(currentMeasureIndex + 1); // 1-based display

  const fontSize = sp * 1.6;
  const x = contentX + sp * 0.3;
  const y = staff.y - sp * 1.8;

  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";

  // Paper background
  const metrics = ctx.measureText(text);
  const pad = sp * 0.3;
  const ascent = metrics.actualBoundingBoxAscent ?? fontSize * 0.8;
  ctx.fillStyle = paperFill;
  ctx.fillRect(x - pad, y - ascent - pad, metrics.width + pad * 2, ascent + pad * 2);

  // Draw number
  ctx.fillStyle = "#333333";
  ctx.fillText(text, x, y);
}
