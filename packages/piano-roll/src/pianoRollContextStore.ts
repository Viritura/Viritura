/**
 * Private context wiring for `PianoRollProvider` / hook consumers.
 *
 * Kept in a `.ts` (not `.tsx`) file so we can export both the React
 * context object and the consumer hook without tripping
 * `react-refresh/only-export-components` on the provider's `.tsx`.
 */

import { createContext, useContext } from "react";
import type { PianoRollSelection, PianoRollViewport } from "./types";

export interface PianoRollContextValue {
  viewport: PianoRollViewport;
  selection: PianoRollSelection;
  setViewport: (v: PianoRollViewport | ((prev: PianoRollViewport) => PianoRollViewport)) => void;
  setSelection: (ids: PianoRollSelection) => void;
  clearSelection: () => void;
}

export const PianoRollReactContext = createContext<PianoRollContextValue | null>(null);

export function usePianoRollContext(): PianoRollContextValue {
  const value = useContext(PianoRollReactContext);
  if (!value) {
    throw new Error("usePianoRollContext must be used inside <PianoRollProvider>");
  }
  return value;
}
