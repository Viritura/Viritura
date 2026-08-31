/**
 * @viritura/piano-roll — read-only piano-roll visualization with a
 * future-editing-friendly projection shape.
 *
 * Mount as:
 *
 *   <PianoRollProvider>
 *     <PianoKeyboard widthPx={64} heightPx={...} viewport={...} />
 *     <PianoRollCanvas notes={projectToRoll(score)} playheadSeconds={...} />
 *   </PianoRollProvider>
 *
 * See `RollView` in the editor for an end-to-end wiring example.
 */

export { PianoRollProvider } from "./PianoRollContext";
export { usePianoRollActions, usePianoRollSelection, usePianoRollViewport } from "./usePianoRoll";
export { PianoRollCanvas } from "./PianoRollCanvas";
export { PianoKeyboard } from "./PianoKeyboard";
export { FpsCounter } from "./FpsCounter";
export { projectToRoll } from "./projectToRoll";
export {
  isBlackKey,
  isWhiteKey,
  buildKeyLayout,
  timeToY,
  yToTime,
  snapBeatToGrid,
  MIN_MIDI,
  MAX_MIDI,
} from "./pianoRollGrid";
export type { KeyBounds } from "./pianoRollGrid";
export type { PianoRollGrid, PianoRollNote, PianoRollSelection, PianoRollViewport } from "./types";
