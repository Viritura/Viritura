/**
 * PianoRollProvider — owns viewport + selection state for the roll.
 *
 * The actual React context object and the consumer hook live in
 * `pianoRollContextStore.ts` (a `.ts` file) so this `.tsx` file stays
 * components-only — required by `react-refresh/only-export-components`
 * to keep Fast Refresh working for the provider.
 *
 * When edits arrive (insert/delete/move), the corresponding command
 * actions will hang off this same context.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { MAX_MIDI, MIN_MIDI } from "./pianoRollGrid";
import { PianoRollReactContext, type PianoRollContextValue } from "./pianoRollContextStore";
import type { PianoRollSelection, PianoRollViewport } from "./types";

const DEFAULT_VIEWPORT: PianoRollViewport = {
  // Show ~4 seconds of look-ahead by default. Comfortable reading pace
  // at typical orchestral tempos; user can wheel-zoom to taste.
  secondsAhead: 4,
  minMidi: MIN_MIDI,
  maxMidi: MAX_MIDI,
};

interface PianoRollProviderProps {
  children: ReactNode;
  /** Optional initial viewport override (e.g. for tests / Storybook). */
  initialViewport?: PianoRollViewport;
}

export function PianoRollProvider({ children, initialViewport }: PianoRollProviderProps) {
  const [viewport, setViewportState] = useState<PianoRollViewport>(initialViewport ?? DEFAULT_VIEWPORT);
  const [selection, setSelectionState] = useState<PianoRollSelection>(() => new Set<string>());

  const setViewport = useCallback((v: PianoRollViewport | ((prev: PianoRollViewport) => PianoRollViewport)) => {
    setViewportState((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      // Clamp pitch range to the playable piano.
      const minMidi = Math.max(0, Math.min(127, next.minMidi));
      const maxMidi = Math.max(minMidi + 1, Math.min(127, next.maxMidi));
      if (minMidi === next.minMidi && maxMidi === next.maxMidi) return next;
      return { ...next, minMidi, maxMidi };
    });
  }, []);

  const setSelection = useCallback((ids: PianoRollSelection) => setSelectionState(ids), []);
  const clearSelection = useCallback(() => setSelectionState(new Set<string>()), []);

  const value = useMemo<PianoRollContextValue>(
    () => ({ viewport, selection, setViewport, setSelection, clearSelection }),
    [viewport, selection, setViewport, setSelection, clearSelection],
  );

  return <PianoRollReactContext.Provider value={value}>{children}</PianoRollReactContext.Provider>;
}
