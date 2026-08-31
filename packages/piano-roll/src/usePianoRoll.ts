/**
 * Public hooks for piano-roll consumers.
 *
 * Split out from `PianoRollContext.tsx` so the .tsx file can stay
 * components-only (react-refresh/only-export-components).
 */

import { usePianoRollContext } from "./pianoRollContextStore";
import type { PianoRollSelection, PianoRollViewport } from "./types";

/** Subscribe to the current viewport (camera). Cheap; updates per pan/zoom. */
export function usePianoRollViewport(): PianoRollViewport {
  return usePianoRollContext().viewport;
}

/** Subscribe to the current selection. Updates on every selection change. */
export function usePianoRollSelection(): PianoRollSelection {
  return usePianoRollContext().selection;
}

/** Imperative actions for changing viewport + selection. */
export function usePianoRollActions() {
  const { setViewport, setSelection, clearSelection } = usePianoRollContext();
  return { setViewport, setSelection, clearSelection };
}
