/**
 * Canvas 2D painter — draws score elements onto a Canvas.
 *
 * Uses simple geometric shapes for this initial version:
 * - Circles for noteheads
 * - Lines for stems, staff lines, barlines, ledger lines
 * - Basic shapes for clefs (simplified representation)
 * - Numbers/text for time signatures
 */

import type { LayoutPage, LayoutSystem, LayoutMeasure, LayoutEvent } from "./layout";
import { isRest } from "@viritura/core";
import { DEFAULT_SPATIUM_PX, STAFF_LINES } from "@viritura/core";

const BLACK = "#000000";
const _GRAY = "#AAAAAA";
const REST_COLOR = "#333333";
const LEDGER_LINE_EXTENSION = 0.6; // in spatium, beyond notehead

let clefWarningShown = false;

/**
 * Paint a full score page onto a canvas context.
 *
 * @deprecated Use {@link paintDisplayList} with the WASM engine instead.
 * This legacy painter uses geometric approximations; the WASM path
 * produces proper SMuFL glyph rendering via DisplayList commands.
 */
export function paintPage(ctx: CanvasRenderingContext2D, page: LayoutPage, sp: number = DEFAULT_SPATIUM_PX): void {
  // Clear
  ctx.clearRect(0, 0, page.width, page.height);

  // White background
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, page.width, page.height);

  for (const system of page.systems) {
    paintSystem(ctx, system, sp);
  }
}

// ═══════════════════════════════════════════
// System
// ═══════════════════════════════════════════

function paintSystem(ctx: CanvasRenderingContext2D, system: LayoutSystem, sp: number): void {
  const staffHeight = (STAFF_LINES - 1) * sp;

  // Draw staff lines across the full system width
  const totalWidth = system.measures.reduce((sum, m) => sum + m.width, 0);

  ctx.strokeStyle = BLACK;
  ctx.lineWidth = 0.08 * sp;

  for (let line = 0; line < STAFF_LINES; line++) {
    const y = system.staffY + line * sp;
    ctx.beginPath();
    ctx.moveTo(system.x, y);
    ctx.lineTo(system.x + totalWidth, y);
    ctx.stroke();
  }

  // Paint each measure
  for (const measure of system.measures) {
    paintMeasure(ctx, measure, system.staffY, sp);
  }

  // Final barline at end
  const lastMeasure = system.measures[system.measures.length - 1];
  if (lastMeasure) {
    const endX = lastMeasure.x + lastMeasure.width;
    const barlineType = lastMeasure.resolved.global.barline?.type ?? "regular";
    paintBarline(ctx, endX, system.staffY, staffHeight, sp, barlineType);
  }
}

// ═══════════════════════════════════════════
// Measure
// ═══════════════════════════════════════════

function paintMeasure(ctx: CanvasRenderingContext2D, measure: LayoutMeasure, staffY: number, sp: number): void {
  const staffHeight = (STAFF_LINES - 1) * sp;
  const rm = measure.resolved;
  const isFirst = rm.index === 0;

  let xCursor = measure.x;

  // Draw barline at start of measure (except first)
  if (!isFirst) {
    paintBarline(ctx, measure.x, staffY, staffHeight, sp, "regular");
    xCursor += 0.5 * sp;
  }

  // Clef (first measure or on change)
  if (isFirst && rm.part.clefs && rm.part.clefs.length > 0) {
    const clef = rm.part.clefs[0]!.clef;
    paintClef(ctx, xCursor + 0.5 * sp, staffY, sp, clef.sign);
    xCursor += 3.0 * sp;
  }

  // Key signature
  const hasKeySig = rm.global.key !== undefined || (isFirst && rm.activeKey.fifths !== 0);
  if (hasKeySig && rm.activeKey.fifths !== 0) {
    xCursor = paintKeySignature(ctx, xCursor, staffY, sp, rm.activeKey.fifths, rm.part.clefs?.[0]?.clef.sign ?? "G");
  }

  // Time signature
  if (rm.global.time) {
    paintTimeSignature(ctx, xCursor + 0.3 * sp, staffY, sp, rm.global.time.count, rm.global.time.unit);
    xCursor += 2.5 * sp;
  }

  // Events (notes/rests)
  for (const layoutEvent of measure.events) {
    paintEvent(ctx, layoutEvent, staffY, sp);
  }
}

// ═══════════════════════════════════════════
// Barline
// ═══════════════════════════════════════════

function paintBarline(
  ctx: CanvasRenderingContext2D,
  x: number,
  staffY: number,
  staffHeight: number,
  sp: number,
  type: string,
): void {
  ctx.strokeStyle = BLACK;

  if (type === "final") {
    // Thin-thick double barline
    ctx.lineWidth = 0.08 * sp;
    ctx.beginPath();
    ctx.moveTo(x - 0.4 * sp, staffY);
    ctx.lineTo(x - 0.4 * sp, staffY + staffHeight);
    ctx.stroke();

    ctx.lineWidth = 0.3 * sp;
    ctx.beginPath();
    ctx.moveTo(x - 0.05 * sp, staffY);
    ctx.lineTo(x - 0.05 * sp, staffY + staffHeight);
    ctx.stroke();
  } else if (type === "double") {
    ctx.lineWidth = 0.08 * sp;
    ctx.beginPath();
    ctx.moveTo(x - 0.2 * sp, staffY);
    ctx.lineTo(x - 0.2 * sp, staffY + staffHeight);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 0.1 * sp, staffY);
    ctx.lineTo(x + 0.1 * sp, staffY + staffHeight);
    ctx.stroke();
  } else {
    // Regular barline
    ctx.lineWidth = 0.1 * sp;
    ctx.beginPath();
    ctx.moveTo(x, staffY);
    ctx.lineTo(x, staffY + staffHeight);
    ctx.stroke();
  }
}

// ═══════════════════════════════════════════
// Clef (legacy placeholder — WASM engine now renders proper SMuFL glyphs)
// ═══════════════════════════════════════════

/**
 * Draw a clef using Unicode placeholder characters.
 *
 * @deprecated The WASM engine now emits DrawGlyph commands with proper SMuFL
 * codepoints (rendered via {@link paintDisplayList}). This fallback only runs
 * when using the legacy {@link ScoreRenderer} / {@link paintPage} path.
 */
function paintClef(ctx: CanvasRenderingContext2D, x: number, staffY: number, sp: number, sign: string): void {
  if (!clefWarningShown) {
    console.warn(
      "[Viritura] paintClef: using legacy Unicode placeholder for clef rendering. " +
        "Switch to the WASM engine + paintDisplayList for proper SMuFL glyph output.",
    );
    clefWarningShown = true;
  }

  ctx.fillStyle = BLACK;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  if (sign === "G") {
    ctx.font = `bold ${sp * 4}px serif`;
    ctx.fillText("𝄞", x, staffY + 2 * sp);
  } else if (sign === "F") {
    ctx.font = `bold ${sp * 3}px serif`;
    ctx.fillText("𝄢", x, staffY + 1.5 * sp);
  } else if (sign === "C") {
    ctx.font = `bold ${sp * 3}px serif`;
    ctx.fillText("𝄡", x, staffY + 2 * sp);
  }
}

// ═══════════════════════════════════════════
// Key signature
// ═══════════════════════════════════════════

function paintKeySignature(
  ctx: CanvasRenderingContext2D,
  x: number,
  staffY: number,
  sp: number,
  fifths: number,
  _clefSign: string,
): number {
  ctx.fillStyle = BLACK;
  ctx.font = `${sp * 1.8}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const isSharps = fifths > 0;
  const count = Math.abs(fifths);
  const symbol = isSharps ? "♯" : "♭";

  // Staff positions for sharps/flats in treble clef (from top line)
  // Treble clef sharp order positions (in half-spaces from top line): F5=0, C5=3, G5=-1, D5=2, A4=5, E5=1, B4=4
  const sharpPositions = [0, 3, -0.5, 2.5, 5.5, 1.5, 4.5]; // approximate
  const flatPositions = [4, 1, 4.5, 1.5, 5, 2, 5.5]; // approximate

  const positions = isSharps ? sharpPositions : flatPositions;

  let xCur = x + 0.5 * sp;
  for (let i = 0; i < count && i < positions.length; i++) {
    const yPos = staffY + positions[i]! * sp * 0.5;
    ctx.fillText(symbol, xCur, yPos);
    xCur += 0.7 * sp;
  }

  return xCur + 0.3 * sp;
}

// ═══════════════════════════════════════════
// Time signature
// ═══════════════════════════════════════════

function paintTimeSignature(
  ctx: CanvasRenderingContext2D,
  x: number,
  staffY: number,
  sp: number,
  count: number,
  unit: number,
): void {
  ctx.fillStyle = BLACK;
  ctx.font = `bold ${sp * 1.8}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Numerator centered on top 2 lines
  ctx.fillText(String(count), x + 1 * sp, staffY + 1 * sp);
  // Denominator centered on bottom 2 lines
  ctx.fillText(String(unit), x + 1 * sp, staffY + 3 * sp);
}

// ═══════════════════════════════════════════
// Event (note / rest)
// ═══════════════════════════════════════════

function drawLedgerLines(
  ctx: CanvasRenderingContext2D,
  pos: number,
  staffY: number,
  x: number,
  noteheadWidth: number,
  sp: number,
): void {
  ctx.strokeStyle = BLACK;
  ctx.lineWidth = 0.08 * sp;
  if (pos < 0) {
    // Above staff
    for (let ledger = -2; ledger >= pos; ledger -= 2) {
      const ledgerY = staffY + ledger * sp * 0.5;
      ctx.beginPath();
      ctx.moveTo(x - LEDGER_LINE_EXTENSION * sp, ledgerY);
      ctx.lineTo(x + noteheadWidth + LEDGER_LINE_EXTENSION * sp, ledgerY);
      ctx.stroke();
    }
  }
  if (pos > 8) {
    // Below staff (pos 8 = bottom line)
    for (let ledger = 10; ledger <= pos; ledger += 2) {
      const ledgerY = staffY + ledger * sp * 0.5;
      ctx.beginPath();
      ctx.moveTo(x - LEDGER_LINE_EXTENSION * sp, ledgerY);
      ctx.lineTo(x + noteheadWidth + LEDGER_LINE_EXTENSION * sp, ledgerY);
      ctx.stroke();
    }
  }
}

function drawNoteheadEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  noteY: number,
  noteheadWidth: number,
  noteheadHeight: number,
  filled: boolean,
  sp: number,
): void {
  ctx.save();
  ctx.translate(x + noteheadWidth / 2, noteY);
  ctx.rotate(-0.15); // slight tilt like real noteheads
  ctx.beginPath();
  ctx.ellipse(0, 0, noteheadWidth / 2, noteheadHeight / 2, 0, 0, Math.PI * 2);
  if (filled) {
    ctx.fillStyle = BLACK;
    ctx.fill();
  } else {
    ctx.strokeStyle = BLACK;
    ctx.lineWidth = 0.12 * sp;
    ctx.stroke();
  }
  ctx.restore();
}

function drawAugmentationDots(
  ctx: CanvasRenderingContext2D,
  x: number,
  noteY: number,
  pos: number,
  dots: number,
  noteheadWidth: number,
  sp: number,
): void {
  for (let d = 0; d < dots; d++) {
    const dotX = x + noteheadWidth + (0.4 + d * 0.5) * sp;
    // Dot should not sit on a line — nudge if needed
    let dotY = noteY;
    if (pos % 2 === 0) dotY -= 0.25 * sp; // nudge up if on a line
    ctx.beginPath();
    ctx.fillStyle = BLACK;
    ctx.arc(dotX, dotY, 0.15 * sp, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintEvent(ctx: CanvasRenderingContext2D, layoutEvent: LayoutEvent, staffY: number, sp: number): void {
  const { event, x, notePositions, stemUp } = layoutEvent;

  if (isRest(event)) {
    paintRest(ctx, x, staffY, sp, event.duration.base);
    return;
  }

  if (!event.notes || event.notes.length === 0) return;

  const noteheadWidth = 1.18 * sp;
  const noteheadHeight = 0.9 * sp;
  const stemWidth = 0.1 * sp;
  const stemLength = 3.5 * sp;

  // Determine if filled or open notehead
  const filled = event.duration.base !== "whole" && event.duration.base !== "half";
  const isWhole = event.duration.base === "whole";

  // Draw each notehead
  for (let i = 0; i < notePositions.length; i++) {
    const pos = notePositions[i]!;
    const noteY = staffY + pos * sp * 0.5;

    drawLedgerLines(ctx, pos, staffY, x, noteheadWidth, sp);
    drawNoteheadEllipse(ctx, x, noteY, noteheadWidth, noteheadHeight, filled, sp);

    if (event.duration.dots) {
      drawAugmentationDots(ctx, x, noteY, pos, event.duration.dots, noteheadWidth, sp);
    }
  }

  // Stem (not for whole notes)
  if (!isWhole && notePositions.length > 0) {
    const topPos = Math.min(...notePositions);
    const bottomPos = Math.max(...notePositions);

    ctx.strokeStyle = BLACK;
    ctx.lineWidth = stemWidth;

    if (stemUp) {
      // Stem goes up from right side of notehead
      const stemX = x + noteheadWidth;
      const stemBottom = staffY + bottomPos * sp * 0.5;
      const stemTop = staffY + topPos * sp * 0.5 - stemLength;
      ctx.beginPath();
      ctx.moveTo(stemX, stemBottom);
      ctx.lineTo(stemX, stemTop);
      ctx.stroke();

      // Flag for eighth notes and shorter
      paintFlag(ctx, stemX, stemTop, sp, event.duration.base, true);
    } else {
      // Stem goes down from left side of notehead
      const stemX = x;
      const stemTop = staffY + topPos * sp * 0.5;
      const stemBottom = staffY + bottomPos * sp * 0.5 + stemLength;
      ctx.beginPath();
      ctx.moveTo(stemX, stemTop);
      ctx.lineTo(stemX, stemBottom);
      ctx.stroke();

      // Flag
      paintFlag(ctx, stemX, stemBottom, sp, event.duration.base, false);
    }
  }
}

// ═══════════════════════════════════════════
// Flag (for eighth, sixteenth, etc.)
// ═══════════════════════════════════════════

function paintFlag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sp: number,
  duration: string,
  stemUp: boolean,
): void {
  let flagCount = 0;
  if (duration === "eighth") flagCount = 1;
  else if (duration === "16th") flagCount = 2;
  else if (duration === "32nd") flagCount = 3;
  else if (duration === "64th") flagCount = 4;

  if (flagCount === 0) return;

  ctx.strokeStyle = BLACK;
  ctx.lineWidth = 0.12 * sp;

  for (let f = 0; f < flagCount; f++) {
    const offset = f * 0.7 * sp;
    ctx.beginPath();
    if (stemUp) {
      ctx.moveTo(x, y + offset);
      ctx.quadraticCurveTo(x + 1.2 * sp, y + offset + 0.8 * sp, x + 0.6 * sp, y + offset + 2 * sp);
    } else {
      ctx.moveTo(x, y - offset);
      ctx.quadraticCurveTo(x - 1.2 * sp, y - offset - 0.8 * sp, x - 0.6 * sp, y - offset - 2 * sp);
    }
    ctx.stroke();
  }
}

// ═══════════════════════════════════════════
// Rest
// ═══════════════════════════════════════════

function paintRest(ctx: CanvasRenderingContext2D, x: number, staffY: number, sp: number, duration: string): void {
  ctx.fillStyle = REST_COLOR;
  ctx.font = `${sp * 2.5}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const centerY = staffY + 2 * sp;

  // Use Unicode rest symbols where available, or simple shapes
  switch (duration) {
    case "whole":
      // Whole rest: filled rectangle hanging from line 2 (4th from bottom)
      ctx.fillRect(x, staffY + 1 * sp - 0.4 * sp, 1.2 * sp, 0.4 * sp);
      break;
    case "half":
      // Half rest: filled rectangle sitting on line 3 (middle)
      ctx.fillRect(x, staffY + 2 * sp, 1.2 * sp, 0.4 * sp);
      break;
    case "quarter":
      // Quarter rest: squiggly line approximation
      ctx.fillText("𝄾", x + 0.5 * sp, centerY);
      break;
    case "eighth":
      ctx.fillText("𝄿", x + 0.5 * sp, centerY);
      break;
    case "16th":
      ctx.fillText("𝅀", x + 0.5 * sp, centerY);
      break;
    default:
      // Generic rest: small filled rectangle
      ctx.fillRect(x, centerY - 0.3 * sp, 0.8 * sp, 0.6 * sp);
  }
}
