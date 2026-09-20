import type { ChordQuality, ChordRoot, ChordSymbol } from "../../model";
import { isNoChordText, parseChordSymbolText, parseQuality } from "./text";
import { applyModifiers, type ChordModifiers } from "./modifiers";

/** Derived playback channel only: its runtime part index is score.parts.length. Never persist a Part. */
export const CHORDS_PART_ID = "viritura:derived:chords";
export const UNSUPPORTED_CHORD_MESSAGE = "Unsupported chord: cannot play this symbol.";

export interface SupportedChordSymbol {
  status: "supported";
  rootPitchClass: number;
  bassPitchClass: number;
  /** Sorted, unique chord tones after degree operations, excluding any non-chord slash bass. */
  pitchClasses: number[];
}

export type ChordSymbolResolution =
  SupportedChordSymbol | { status: "silent" } | { status: "unsupported"; message: typeof UNSUPPORTED_CHORD_MESSAGE };

export interface ChordSymbolVoicing {
  /** Exactly one root/slash note in MIDI 36..47 for supported symbols. */
  leftHand: number[];
  /** All chord tones in MIDI 60..71, sorted and deduplicated. */
  rightHand: number[];
}

const NATURAL_PITCHES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const TRIADS: Record<Exclude<ChordQuality, "other">, readonly number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dominant: [0, 4, 7],
  diminished: [0, 3, 6],
  "half-diminished": [0, 3, 6],
  augmented: [0, 4, 8],
  "minor-major": [0, 3, 7],
  suspended2: [0, 2, 7],
  suspended4: [0, 5, 7],
  power: [0, 7],
};

const unsupported = (): ChordSymbolResolution => ({ status: "unsupported", message: UNSUPPORTED_CHORD_MESSAGE });
const modulo = (value: number): number => ((value % 12) + 12) % 12;

function pitchClass(root: ChordRoot): number | undefined {
  const natural = NATURAL_PITCHES[root.step];
  const alter = root.alter ?? 0;
  return typeof natural === "number" && Number.isSafeInteger(alter) ? modulo(natural + modulo(alter)) : undefined;
}

function chordDegrees(
  quality: Exclude<ChordQuality, "other">,
  triad: readonly number[],
  extension: ChordSymbol["extension"],
): Map<number, number[]> {
  const thirdDegree = quality === "suspended2" ? 2 : quality === "suspended4" ? 4 : 3;
  const degrees = new Map<number, number[]>([
    [1, [0]],
    [5, [triad[triad.length - 1]!]],
  ]);
  if (quality !== "power") degrees.set(thirdDegree, [triad[1]!]);
  // A sixth is additive, not a tertian extension: it does not imply a seventh.
  if (extension === 6) degrees.set(6, [9]);
  else if (extension !== undefined) {
    const seventh = quality === "major" || quality === "minor-major" ? 11 : quality === "diminished" ? 9 : 10;
    degrees.set(7, [seventh]);
    if (extension >= 9) degrees.set(9, [2]);
    if (extension >= 11) degrees.set(11, [5]);
    if (extension >= 13) degrees.set(13, [9]);
  }
  return degrees;
}

function resolveBase(chord: ChordSymbol, modifiers?: ChordModifiers): ChordSymbolResolution {
  if (!chord.root) return unsupported();
  const rootPitchClass = pitchClass(chord.root);
  const bassPitchClass = chord.bass ? pitchClass(chord.bass) : rootPitchClass;
  const quality = chord.quality ?? "major";
  if (rootPitchClass === undefined || bassPitchClass === undefined || quality === "other") return unsupported();
  const triad = TRIADS[quality];
  if (!Array.isArray(triad)) return unsupported();
  const impliedSeventh = quality === "dominant" || quality === "half-diminished" || quality === "minor-major";
  const extension = chord.extension ?? (impliedSeventh ? 7 : undefined);
  if (extension !== undefined && ![6, 7, 9, 11, 13].includes(extension)) return unsupported();
  if (quality === "power" && extension !== undefined) return unsupported();
  const intervals = applyModifiers(chordDegrees(quality, triad, extension), modifiers);
  return {
    status: "supported",
    rootPitchClass,
    bassPitchClass,
    pitchClasses: [...new Set(intervals.map((interval) => modulo(rootPitchClass + interval)))].sort((a, b) => a - b),
  };
}

function resolveStructured(chord: ChordSymbol): ChordSymbolResolution {
  const base = resolveBase(chord);
  if (chord.kindText === undefined) return base;
  const parsed = parseQuality(chord.kindText);
  if (!parsed) return unsupported();
  const description = { ...chord, quality: parsed.quality, extension: parsed.extension };
  const described = resolveBase(description);
  if (!equivalent(base, described)) return unsupported();
  const result = resolveBase(chord, parsed.modifiers);
  return equivalent(result, resolveBase(description, parsed.modifiers)) ? result : unsupported();
}

function resolveText(text: string, chord: ChordSymbol): ChordSymbolResolution {
  if (isNoChordText(text)) return { status: "silent" };
  return resolveStructured(parseChordSymbolText(text, chord.position));
}

function equivalent(a: ChordSymbolResolution, b: ChordSymbolResolution): boolean {
  if (a.status === "silent" && b.status === "silent") return true;
  return (
    a.status === "supported" &&
    b.status === "supported" &&
    a.rootPitchClass === b.rootPitchClass &&
    a.bassPitchClass === b.bassPitchClass &&
    a.pitchClasses.length === b.pitchClasses.length &&
    a.pitchClasses.every((pitch, index) => pitch === b.pitchClasses[index])
  );
}

/**
 * The single musical interpretation for validation, UI and playback.
 * A missing quality on a structured root means major; unknown qualities never do.
 * Raw syntax and display overrides must agree with structured harmony. NC is
 * silent only when it has no contradictory structured fields or display text.
 */
export function resolveChordSymbol(chord: ChordSymbol): ChordSymbolResolution {
  let result: ChordSymbolResolution;
  if (chord.root) {
    result = resolveStructured(chord);
    if (chord.rawText !== undefined && !equivalent(result, resolveText(chord.rawText, chord))) return unsupported();
  } else {
    if (
      chord.rawText === undefined ||
      chord.bass ||
      chord.quality ||
      chord.extension !== undefined ||
      chord.kindText !== undefined
    ) {
      return unsupported();
    }
    result = resolveText(chord.rawText, chord);
  }
  if (chord.textOverride !== undefined && !equivalent(result, resolveText(chord.textOverride, chord)))
    return unsupported();
  return result;
}

/** Unsupported/NC symbols produce no notes; callers display resolver diagnostics separately. */
export function voiceChordSymbol(chord: ChordSymbol): ChordSymbolVoicing {
  const result = resolveChordSymbol(chord);
  if (result.status !== "supported") return { leftHand: [], rightHand: [] };
  return {
    leftHand: [36 + result.bassPitchClass],
    rightHand: result.pitchClasses.map((pitch) => 60 + pitch),
  };
}
