/**
 * Bravura SMuFL glyph bounding boxes in **staff spaces** (1 em = 4 staff
 * spaces), copied verbatim from `bravura_metadata.json#glyphBBoxes`.
 * Consumers must divide by 4 to convert to em units.
 *
 * Why this exists: Chromium's `CanvasRenderingContext2D.measureText()` returns
 * unreliable `actualBoundingBox*` values for SMuFL private-use codepoints
 * (Windows builds typically report only a fraction of the true ink extent —
 * e.g. `actAsc=9, actDes=8` at 24.8px for `accidentalNatural` whose real
 * Bravura bbox is `actAsc≈33.8, actDes≈33.2`). Using these published em
 * bboxes restores correct per-glyph centering math in `BravuraGlyph`.
 *
 * Only the codepoints used in UI primitives (toolbar / palette / inspector)
 * are populated. Glyphs not in this table fall back to measureText.
 *
 * Conventions: y axis is musical (ascent positive, descent negative). Mirrors
 * the upstream metadata file so values can be diffed against it directly.
 */
export interface GlyphBBoxEm {
  /** bBoxNE.y — ink top above baseline, in staff-spaces (em × 4). */
  readonly ascent: number;
  /** -bBoxSW.y — ink bottom below baseline, in staff-spaces (em × 4), ≥ 0. */
  readonly descent: number;
}

export const BRAVURA_GLYPH_BBOXES: Record<string, GlyphBBoxEm> = {
  // Accidentals
  "\uE260": { ascent: 1.756, descent: 0.7 }, // accidentalFlat
  "\uE261": { ascent: 1.364, descent: 1.34 }, // accidentalNatural
  "\uE262": { ascent: 1.4, descent: 1.392 }, // accidentalSharp
  "\uE263": { ascent: 0.508, descent: 0.5 }, // accidentalDoubleSharp
  "\uE264": { ascent: 1.748, descent: 0.7 }, // accidentalDoubleFlat
  "\uE265": { ascent: 1.4, descent: 1.392 }, // accidentalTripleSharp
  "\uE266": { ascent: 1.756, descent: 0.7 }, // accidentalTripleFlat
  // Noteheads (used as the duration-row baseline anchor)
  "\uE0A2": { ascent: 0.5, descent: 0.5 }, // noteheadWhole
  "\uE0A3": { ascent: 0.5, descent: 0.5 }, // noteheadHalf
  "\uE0A4": { ascent: 0.5, descent: 0.5 }, // noteheadBlack
  // Metronome glyphs (toolbar duration row + tempo button)
  "\uECA0": { ascent: 0.68, descent: 0.672 }, // metNoteDoubleWhole
  "\uECA2": { ascent: 0.592, descent: 0.5 }, // metNoteWhole
  "\uECA3": { ascent: 2.752, descent: 0.564 }, // metNoteHalfUp
  "\uECA5": { ascent: 2.752, descent: 0.564 }, // metNoteQuarterUp
  "\uECA7": { ascent: 2.784, descent: 0.564 }, // metNote8thUp
  "\uECA9": { ascent: 2.8, descent: 0.564 }, // metNote16thUp
  "\uECAB": { ascent: 3.692, descent: 0.564 }, // metNote32ndUp
  "\uECAD": { ascent: 4.392, descent: 0.564 }, // metNote64thUp
  // Time signatures
  "\uE08A": { ascent: 1.004, descent: 0.996 }, // timeSigCommon
  "\uE08B": { ascent: 1.444, descent: 1.436 }, // timeSigCutCommon
  "\uE09C": { ascent: 1.0, descent: 0.992 }, // timeSigOpenPenderecki
  // Rests
  "\uE4E3": { ascent: 0.036, descent: 0.54 }, // restWhole
  "\uE4E4": { ascent: 0.568, descent: 0.008 }, // restHalf
  "\uE4E5": { ascent: 1.492, descent: 1.5 }, // restQuarter
  "\uE4E6": { ascent: 0.696, descent: 1.004 }, // rest8th
  "\uE4E7": { ascent: 0.716, descent: 2.0 }, // rest16th
  "\uE4E8": { ascent: 1.704, descent: 2.0 }, // rest32nd
  "\uE4E9": { ascent: 1.72, descent: 3.012 }, // rest64th
};
