import type { Clef as RawClef, PositionedClef as RawPositionedClef } from "../raw";
import type { ClefSign } from "../enums";
import type { Narrow } from "./_derive";

/**
 * A clef definition. Derived from MNX raw `clef`, with `sign` extended
 * to include `"TAB"` (tablature clef) — a hand-synthesised value the
 * parser produces for guitar/bass tab parts, not present in raw MNX.
 *
 * All raw fields preserved as-is:
 *   - staffPosition: half-spaces from middle line (MNX convention)
 *   - color, glyph (SMuFL override), octave (ottava transposition), showOctave
 */
export type Clef = Narrow<
  RawClef,
  {
    sign: ClefSign;
    /** Ottava transposition. Kept as `number` rather than the raw narrow
     *  union (`-3..3` excluding 0 wrapper) so callers that compute octaves
     *  numerically type-check without per-call casts. */
    octave?: number;
  }
>;

/**
 * A positioned clef at a specific point in a measure. Derived from raw
 * `positioned-clef`, but `position` is narrowed from raw `rhythmic-position`
 * (which carries `fraction` + optional `graceIndex` + global-attrs) to
 * just the fraction tuple the parser actually populates — the decoded
 * model never needs grace-index or id on positioned-clef positions.
 *
 * The inner `clef` field is also narrowed to use our extended `Clef` type.
 */
export type PositionedClef = Narrow<
  RawPositionedClef,
  {
    clef: Clef;
    position?: { fraction: [number, number] };
  }
>;

/**
 * Get the diatonic position of the reference line for a clef.
 * This is the note that sits ON the clef's line.
 * Returns the diatonic position (C4 = 28, B3 = 27, G4 = 32, etc.)
 */
export function clefReferencePitch(clef: Clef): number {
  // G clef (treble): G4 sits on the clef line
  // F clef (bass): F3 sits on the clef line
  // C clef: C4 sits on the clef line
  switch (clef.sign) {
    case "G":
      return 4 * 7 + 4; // G4 = diatonic 32
    case "F":
      return 3 * 7 + 3; // F3 = diatonic 24
    case "C":
      return 4 * 7 + 0; // C4 = diatonic 28
    default:
      return 4 * 7 + 4; // Default to treble
  }
}

/**
 * Get the staff line (from bottom, 0-based) that the clef reference pitch sits on.
 * MNX staffPosition: -2 for G clef (line 2 from bottom in 0-based counting; MNX uses
 * a coordinate where 0 = middle line, negative = below).
 * We convert to 0-based from bottom: line 0 = bottom line.
 */
export function clefLineFromBottom(clef: Clef): number {
  // MNX staffPosition: 0 = middle line (line 2 from bottom in 5-line staff)
  // staffPosition is in half-spaces from center line (negative = below)
  // Treble G clef: staffPosition = -2 → line 1 from bottom (0-indexed)
  // Bass F clef:   staffPosition = +2 → line 3 from bottom (0-indexed)
  return 2 + Math.round(clef.staffPosition / 2);
}
