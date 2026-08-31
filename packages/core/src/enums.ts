// ═══════════════════════════════════════════
// Pitch
// ═══════════════════════════════════════════

/** Note names (step) in MNX format — aliased to the raw schema. */
export type Step = import("./raw").Step;

/** Octave range (scientific pitch notation) */
export type Octave = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

// ═══════════════════════════════════════════
// Duration
// ═══════════════════════════════════════════

/**
 * Note value base types. Derived from MNX raw `note-value-base` so the
 * spec is the single source of truth. Includes all MNX values:
 * `duplexMaxima`, `maxima`, `longa`, `breve`, `whole`, `half`, `quarter`,
 * `eighth`, `16th`…`4096th`.
 *
 * Rendering coverage (engine SMuFL):
 *   - Noteheads + rests: `maxima` → `4096th` are supported, with
 *     `longa`/`maxima`/`duplexMaxima` sharing the double-whole notehead.
 *   - Flags: `8th` → `1024th` have SMuFL glyphs (U+E240–U+E24F).
 *   - `2048th` / `4096th`: no SMuFL flag or rest glyph exists; renderers
 *     fall back to extra beam levels (handled at the layout layer).
 */
export type NoteValueBase = import("./raw").NoteValueBase;

// ═══════════════════════════════════════════
// Clef
// ═══════════════════════════════════════════

/** Clef sign types */
export type ClefSign = import("./raw").ClefSign;

// ═══════════════════════════════════════════
// Barline
// ═══════════════════════════════════════════

/**
 * Barline type — aliased to the MNX `barline-type` schema (11 variants).
 *
 * Repeat barlines are NOT part of this enum: MNX represents them as separate
 * `measure.repeatStart` / `measure.repeatEnd` sibling objects. The layout
 * engine combines the end-of-measure barline with the adjacent repeat
 * markers at render time.
 */
export type BarlineType = import("./raw").BarlineType;

// ═══════════════════════════════════════════
// Stem direction
// ═══════════════════════════════════════════

export type StemDirection = "up" | "down" | "auto";

// ═══════════════════════════════════════════
// Accidentals
// ═══════════════════════════════════════════

export type AccidentalType =
  | "sharp"
  | "flat"
  | "natural"
  | "double-sharp"
  | "double-flat"
  | "triple-sharp"
  | "triple-flat";
