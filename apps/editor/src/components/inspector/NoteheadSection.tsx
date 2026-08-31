import type { NoteheadShape } from "@viritura/core";
import { sectionStyle, legendStyle } from "./types";
import { NoteheadPalette } from "../DrumKitDialog";

export interface NoteheadSectionProps {
  /** Current notehead of the selected event (`"normal"` when unset). */
  notehead: NoteheadShape;
  onNoteheadChange: (shape: NoteheadShape) => void;
}

/**
 * Notehead-shape picker for the selected event. Works for both pitched notes
 * (stored as a per-note vendor override) and percussion kit-notes (translated
 * to a kit-component carrying the shape) — the command behind `onNoteheadChange`
 * handles the routing.
 */
export function NoteheadSection({ notehead, onNoteheadChange }: NoteheadSectionProps) {
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Notehead</legend>
      <NoteheadPalette value={notehead} onChange={onNoteheadChange} />
    </fieldset>
  );
}
