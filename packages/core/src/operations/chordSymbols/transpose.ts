import type { ChordRoot, ChordSymbol, Interval } from "../../model";
import { CHORD_TEXT_PATTERN, formatChordRoot, parseChordSymbolText } from "./text";

const STEPS = "CDEFGAB";
const NATURALS = [0, 2, 4, 5, 7, 9, 11];

function transposeRoot(root: ChordRoot, interval: Interval): ChordRoot {
  const index = STEPS.indexOf(root.step);
  if (index < 0 || root.step.length !== 1 || !Number.isSafeInteger(root.alter ?? 0)) return { ...root };
  const target = index + interval.staffDistance;
  const targetIndex = ((target % 7) + 7) % 7;
  const targetNatural = NATURALS[targetIndex]! + 12 * Math.floor(target / 7);
  const alter = NATURALS[index]! + (root.alter ?? 0) + interval.halfSteps - targetNatural;
  return { step: STEPS[targetIndex]!, ...(alter === 0 ? {} : { alter }) };
}

function transposeText(text: string, chord: ChordSymbol, interval: Interval): string {
  const match = CHORD_TEXT_PATTERN.exec(text);
  const parsed = parseChordSymbolText(text, chord.position);
  if (!match || !parsed.root) return text;
  return (
    match[1]! +
    formatChordRoot(transposeRoot(parsed.root, interval)) +
    match[4]! +
    (parsed.bass ? `/${formatChordRoot(transposeRoot(parsed.bass, interval))}` : "") +
    match[7]!
  );
}

/**
 * Immutable spelled transposition of root AND slash bass. Uses MNX's signed
 * Interval (halfSteps + staffDistance), not a guessed enharmonic pitch class.
 * Recognizable roots in unsupported suffixes transpose; malformed text/NC stays
 * verbatim. Raw/override suffixes are retained, so transposition never legitimizes
 * unsupported harmony.
 */
export function transposeChordSymbol(chord: ChordSymbol, interval: Interval): ChordSymbol {
  if (!Number.isSafeInteger(interval.halfSteps) || !Number.isSafeInteger(interval.staffDistance)) {
    throw new RangeError("Chord transposition requires integer halfSteps and staffDistance.");
  }
  if (interval.halfSteps === 0 && interval.staffDistance === 0) return { ...chord };
  return {
    ...chord,
    ...(chord.root ? { root: transposeRoot(chord.root, interval) } : {}),
    ...(chord.bass ? { bass: transposeRoot(chord.bass, interval) } : {}),
    ...(chord.rawText !== undefined ? { rawText: transposeText(chord.rawText, chord, interval) } : {}),
    ...(chord.textOverride !== undefined ? { textOverride: transposeText(chord.textOverride, chord, interval) } : {}),
  };
}
