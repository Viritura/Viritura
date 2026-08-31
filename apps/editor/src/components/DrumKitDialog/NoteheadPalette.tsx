import type { NoteheadShape } from "@viritura/core";
import { NOTEHEAD_GLYPHS, NOTEHEAD_SHAPES } from "./noteheadGlyphs";
import styles from "./NoteheadPalette.module.css";

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
    <div className={styles.row} role="radiogroup" aria-label="Notehead shape">
      {NOTEHEAD_SHAPES.map((shape) => {
        const { glyph, label } = NOTEHEAD_GLYPHS[shape];
        const active = shape === value;
        return (
          // eslint-disable-next-line no-restricted-syntax -- bespoke glyph toggle chip: a SMuFL notehead swatch, not a text button
          <button
            key={shape}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            className={active ? styles.chipActive : styles.chip}
            onClick={() => onChange(shape)}
          >
            <span className={styles.glyph}>{glyph}</span>
          </button>
        );
      })}
    </div>
  );
}
