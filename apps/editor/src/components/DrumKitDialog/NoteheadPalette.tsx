import type { NoteheadShape } from "@viritura/core";
import { GlyphButtonGroup } from "@viritura/ui";
import { NOTEHEAD_GLYPHS, NOTEHEAD_SHAPES } from "./noteheadGlyphs";

export interface NoteheadPaletteProps {
  readonly value: NoteheadShape;
  readonly onChange: (shape: NoteheadShape) => void;
}

/**
 * A row of toggle chips showing the actual Bravura notehead glyphs. Replaces a
 * word-only dropdown — you pick the shape you can see.
 */
export function NoteheadPalette({ value, onChange }: NoteheadPaletteProps) {
  return (
    <GlyphButtonGroup
      ariaLabel="Notehead shape"
      value={value}
      onChange={onChange}
      options={NOTEHEAD_SHAPES.map((shape) => ({ value: shape, ...NOTEHEAD_GLYPHS[shape] }))}
    />
  );
}
