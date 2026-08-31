import type { NoteheadShape } from "@viritura/core";

/** Bravura SMuFL codepoint for each notehead shape's quarter-note glyph, plus a
 *  short label. Matches the engine's render map (smufl.rs); used by palette
 *  chips and pad/lane badges to show the real notehead the engine will draw. */
export const NOTEHEAD_GLYPHS: Record<NoteheadShape, { glyph: string; label: string }> = {
  normal: { glyph: "\uE0A4", label: "Normal" },
  x: { glyph: "\uE0A9", label: "Cross" },
  circleX: { glyph: "\uE0B3", label: "Circle-X" },
  diamond: { glyph: "\uE0DB", label: "Diamond" },
  slash: { glyph: "\uE103", label: "Slash" },
  triangleUp: { glyph: "\uE0BF", label: "Triangle up" },
  triangleDown: { glyph: "\uE0C7", label: "Triangle down" },
};

/** Notehead shapes in palette order. */
export const NOTEHEAD_SHAPES: readonly NoteheadShape[] = [
  "normal",
  "x",
  "circleX",
  "diamond",
  "triangleUp",
  "triangleDown",
  "slash",
];

/** The Bravura glyph for a notehead shape (quarter-note form). */
export function noteheadGlyph(shape: NoteheadShape): string {
  return NOTEHEAD_GLYPHS[shape]?.glyph ?? NOTEHEAD_GLYPHS.normal.glyph;
}
