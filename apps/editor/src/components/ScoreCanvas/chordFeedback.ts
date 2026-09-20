import { resolveChordSymbol, type ChordSymbol, type Score } from "@viritura/core";
import { canonicalChordSymbolId } from "../../score/ElementPath";

/** Read concert harmony from the document, never from a transposed rendered copy. */
export function globalChordForElement(score: Score | null, elementId: string): ChordSymbol | undefined {
  const canonical = canonicalChordSymbolId(elementId);
  const match = canonical?.match(/^m(\d+)\/chord(\d+)$/);
  if (!match) return undefined;
  return score?.global.measures[Number(match[1])]?.chordSymbols?.[Number(match[2])];
}

export function previewClickedChord(
  score: Score | null,
  elementId: string,
  previewChord: ((chord: ChordSymbol, updatedScore?: Score) => Promise<void>) | undefined,
): void {
  const chord = globalChordForElement(score, elementId);
  if (!score || !chord || resolveChordSymbol(chord).status !== "supported") return;
  // Device initialization can fail; an audition must not interrupt selection.
  void previewChord?.(chord, score).catch(() => {});
}
