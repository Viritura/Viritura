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
  if (!score || !chord) {
    if (/(?:^|\/)chord\d/.test(elementId)) {
      console.warn("[Audio] Cannot resolve clicked chord:", elementId);
    }
    return;
  }
  if (resolveChordSymbol(chord).status !== "supported") return;
  if (!previewChord) {
    console.warn("[Audio] Clicked chord preview is unavailable:", elementId);
    return;
  }
  // Device initialization can fail; an audition must not interrupt selection.
  void previewChord(chord, score).catch((error: unknown) => {
    console.warn("[Audio] Clicked chord preview failed:", elementId, error);
  });
}
