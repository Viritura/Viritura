import type { CSSProperties } from "react";
import type { NoteheadShape } from "@viritura/core";
import { noteheadGlyph } from "./noteheadGlyphs";

/**
 * A tiny rendered staff with a single notehead at its MNX staff position —
 * the icon shown inside a Pad Kit pad. Follows the same SVG-staff-in-a-button
 * pattern as the palette's `ClefGlyph`/`BarlineGlyph`: 5 staff lines drawn as
 * `<line>`s plus a Bravura notehead glyph placed at the correct line/space,
 * with ledger lines for positions outside the staff.
 *
 * Staff-position convention (MNX): 0 = middle line; +4 = top line, −4 = bottom
 * line; even = lines, odd = spaces; + above, − below.
 */

/** Staff space (px). Small, for a pad-sized icon. */
const SP = 5;
/** Drawable vertical window in staff positions (2 ledger lines above/below). */
const TOP_POS = 8;
const BOT_POS = -8;
const STAFF_HEIGHT = SP * 4;
/** Vertical pixels from the SVG top to the top staff line. */
const PAD_TOP = ((TOP_POS - 4) / 2) * SP; // room above the top line for high notes
const PAD_BOTTOM = ((-4 - BOT_POS) / 2) * SP; // room below the bottom line
const SVG_HEIGHT = PAD_TOP + STAFF_HEIGHT + PAD_BOTTOM;
const CONTENT_WIDTH = SP * 6;
const GLYPH_SIZE = SP * 4;
const LEDGER_HALF = SP * 0.9;
const LINE_EXTEND = SP * 0.6;
/** Stem geometry. */
const STEM_LEN = SP * 3.2;
const STEM_WIDTH = 0.7;

/**
 * Per-shape stem-attachment anchors (SMuFL `glyphsWithAnchors`, black/quarter
 * variants), transcribed from `bravura_metadata.json`. Values are in staff
 * spaces, SMuFL's Y-up convention:
 *  - `width`: the notehead advance width — the glyph is centered (textAnchor
 *    "middle"), so an up-stem attaches at `+width/2`, a down-stem at `−width/2`.
 *  - `upY` (`stemUpSE.y`) / `downY` (`stemDownNW.y`): the vertical attachment.
 *    These vary per shape — an X attaches near its outer corners (±0.44), a
 *    triangle at its flat edge (same Y for up and down), a diamond/circle-X at
 *    the vertical center (0). Screen Y is down-positive, so attach
 *    `y = noteY − anchorY·SP`.
 */
const STEM_ANCHORS: Record<NoteheadShape, { width: number; upY: number; downY: number }> = {
  normal: { width: 1.18, upY: 0.168, downY: -0.168 },
  x: { width: 1.16, upY: 0.444, downY: -0.44 },
  circleX: { width: 0.996, upY: 0, downY: 0 },
  diamond: { width: 1.0, upY: 0, downY: 0 },
  triangleUp: { width: 1.172, upY: -0.5, downY: -0.5 },
  triangleDown: { width: 1.168, upY: 0.5, downY: 0.5 },
  slash: { width: 1.46, upY: 0.656, downY: -0.664 },
};

const SVG_STYLE: CSSProperties = { display: "block", maxWidth: "100%", maxHeight: "100%" };

/** Y pixel (SVG space) for a staff position. pos 0 = middle line. */
function yForPos(pos: number): number {
  return PAD_TOP + (2 - pos / 2) * SP;
}

/** Even line positions needing a ledger line for a notehead at `pos`. */
function ledgerPositions(pos: number): number[] {
  const out: number[] = [];
  if (pos >= 6) for (let e = 6; e <= pos; e += 2) out.push(e);
  else if (pos <= -6) for (let e = -6; e >= pos; e -= 2) out.push(e);
  return out;
}

export interface KitNoteGlyphProps {
  readonly staffPosition: number;
  readonly notehead: NoteheadShape;
}

export function KitNoteGlyph({ staffPosition, notehead }: KitNoteGlyphProps) {
  const cx = CONTENT_WIDTH / 2;
  const pos = Math.max(BOT_POS, Math.min(TOP_POS, staffPosition));
  const noteY = yForPos(pos);
  // Standard single-voice rule: at/above the middle line the stem points down
  // (left side of the notehead); below it the stem points up (right side). The
  // exact attachment point comes from the per-shape SMuFL anchor so X /
  // triangle / diamond stems land where the font intends, not at a fixed edge.
  const stemUp = pos < 0;
  const anchor = STEM_ANCHORS[notehead];
  const halfW = (anchor.width / 2) * SP;
  const stemX = stemUp ? cx + halfW : cx - halfW;
  const stemBaseY = noteY - (stemUp ? anchor.upY : anchor.downY) * SP;
  const stemEndY = stemUp ? stemBaseY - STEM_LEN : stemBaseY + STEM_LEN;

  return (
    <svg
      viewBox={`0 0 ${CONTENT_WIDTH} ${SVG_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      style={SVG_STYLE}
      aria-hidden
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={i}
          x1={-LINE_EXTEND}
          y1={PAD_TOP + i * SP}
          x2={CONTENT_WIDTH + LINE_EXTEND}
          y2={PAD_TOP + i * SP}
          stroke="currentColor"
          strokeWidth={0.5}
          opacity={0.55}
        />
      ))}
      {ledgerPositions(pos).map((e) => (
        <line
          key={`l${e}`}
          x1={cx - LEDGER_HALF}
          y1={yForPos(e)}
          x2={cx + LEDGER_HALF}
          y2={yForPos(e)}
          stroke="currentColor"
          strokeWidth={0.6}
          opacity={0.7}
        />
      ))}
      <text x={cx} y={noteY} fontFamily="Bravura" fontSize={GLYPH_SIZE} fill="currentColor" textAnchor="middle">
        {noteheadGlyph(notehead)}
      </text>
      <line
        x1={stemX}
        y1={stemBaseY}
        x2={stemX}
        y2={stemEndY}
        stroke="currentColor"
        strokeWidth={STEM_WIDTH}
        strokeLinecap="round"
      />
    </svg>
  );
}
