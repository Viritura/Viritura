import { initialInstrumentState } from "./instrumentChange";
import type { Part } from "./part";

// Keep the sound-ID families in sync with the Rust engine's Part::shows_chord_symbols.
const AUTOMATIC_CHORD_INSTRUMENTS = ["keyboard.piano", "pluck.bass", "pluck.guitar", "strings.contrabass"] as const;

/** Whether the source part displays the document-wide chord progression. */
export function partShowsChordSymbols(part: Part): boolean {
  if (part.chordSymbolVisibility === "show") return true;
  if (part.chordSymbolVisibility === "hide") return false;

  const instrumentId = part._x?.viritura?.instrumentId ?? initialInstrumentState(part).instrument?.instrumentId;
  return (
    instrumentId !== undefined &&
    AUTOMATIC_CHORD_INSTRUMENTS.some((family) => instrumentId === family || instrumentId.startsWith(`${family}.`))
  );
}
