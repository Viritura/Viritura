import type { ChordSymbol, GlobalMeasure, RhythmicPosition } from "../../model";
import { resolveChordSymbol } from "./resolution";
import { formatChordSymbolText } from "./text";

function fraction(position: RhythmicPosition): [bigint, bigint] {
  const [numerator, denominator] = position.fraction;
  if (!Number.isSafeInteger(numerator) || numerator < 0 || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError(
      "Chord positions require a nonnegative safe-integer numerator and positive safe-integer denominator.",
    );
  }
  if (position.graceIndex !== undefined && (!Number.isSafeInteger(position.graceIndex) || position.graceIndex < 0)) {
    throw new RangeError("Chord grace indices require nonnegative safe integers.");
  }
  return [BigInt(numerator), BigInt(denominator)];
}

/** Exact rational comparison (no floating-point beat keys). Grace notes precede the main onset. */
export function compareChordSymbolPositions(a: RhythmicPosition, b: RhythmicPosition): number {
  const [an, ad] = fraction(a);
  const [bn, bd] = fraction(b);
  const difference = an * bd - bn * ad;
  if (difference !== 0n) return difference < 0n ? -1 : 1;
  if (a.graceIndex === b.graceIndex) return 0;
  if (a.graceIndex === undefined) return 1;
  if (b.graceIndex === undefined) return -1;
  return a.graceIndex < b.graceIndex ? -1 : 1;
}

/** Immutable replacement of every equivalent onset; unrelated existing harmony is retained. */
export function upsertGlobalChordSymbol(measure: GlobalMeasure, incoming: ChordSymbol): GlobalMeasure {
  fraction(incoming.position);
  const chordSymbols = (measure.chordSymbols ?? []).filter(
    (chord) => compareChordSymbolPositions(chord.position, incoming.position) !== 0,
  );
  chordSymbols.push(incoming);
  chordSymbols.sort((a, b) => compareChordSymbolPositions(a.position, b.position));
  return { ...measure, chordSymbols };
}

export interface ChordSymbolSource {
  /** Source score-part index: smaller means visually higher. No persistent artificial part. */
  partIndex: number;
  chordSymbols: readonly ChordSymbol[];
}

export interface ChordSymbolConflict {
  position: RhythmicPosition;
  keptPartIndex: number;
  discardedPartIndex: number;
  message: string;
}

export interface ChordSymbolMergeResult {
  measure: GlobalMeasure;
  warnings: ChordSymbolConflict[];
}

function sameHarmony(a: ChordSymbol, b: ChordSymbol): boolean {
  const left = resolveChordSymbol(a);
  const right = resolveChordSymbol(b);
  if (left.status !== right.status) return false;
  if (left.status === "silent") return true;
  if (left.status === "supported" && right.status === "supported") {
    return (
      left.rootPitchClass === right.rootPitchClass &&
      left.bassPitchClass === right.bassPitchClass &&
      left.pitchClasses.length === right.pitchClasses.length &&
      left.pitchClasses.every((pitch, index) => pitch === right.pitchClasses[index])
    );
  }
  return formatChordSymbolText(a) === formatChordSymbolText(b);
}

/**
 * Merge only incoming selections into a global measure. At conflicting incoming
 * onsets the topmost source wins (first symbol wins ties within one source).
 * Existing harmony is replaced only at incoming onsets, never consulted as a
 * competing source. Equivalent incoming harmony coalesces without a warning.
 */
export function mergeGlobalChordSymbols(
  measure: GlobalMeasure,
  sources: readonly ChordSymbolSource[],
): ChordSymbolMergeResult {
  const accepted: { chord: ChordSymbol; partIndex: number }[] = [];
  const warnings: ChordSymbolConflict[] = [];
  for (const source of [...sources].sort((a, b) => a.partIndex - b.partIndex)) {
    for (const chord of source.chordSymbols) {
      fraction(chord.position);
      const previous = accepted.find(
        (entry) => compareChordSymbolPositions(entry.chord.position, chord.position) === 0,
      );
      if (!previous) accepted.push({ chord, partIndex: source.partIndex });
      else if (!sameHarmony(previous.chord, chord))
        warnings.push({
          position: chord.position,
          keptPartIndex: previous.partIndex,
          discardedPartIndex: source.partIndex,
          message: "Conflicting chord symbols: kept the topmost source part.",
        });
    }
  }
  return {
    measure: accepted.reduce((result, entry) => upsertGlobalChordSymbol(result, entry.chord), measure),
    warnings,
  };
}
