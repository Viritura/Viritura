import {
  formatChordSymbolText,
  mergeGlobalChordSymbols,
  parseChordSymbolText,
  resolveChordSymbol,
  transposeChordSymbol,
  validateFretboard,
  type ChordRoot,
  type ChordSymbol,
  type Fretboard,
  type Interval,
} from "@viritura/core";
import type { DenigmaDiagnostic, DenigmaFretboardPayload } from "../types";
import { ensureArrayProperty, ensureViritura, type MeasureTarget, type TargetIndex } from "./targetIndex";
import {
  isChordGap,
  isRecord,
  type AdaptedDenigmaGap,
  type ChordPayload,
  type GapApplication,
  type JsonRecord,
} from "./types";
import { isAdaptedDenigmaGap, type NormalizedGap } from "./normalizeReport";

interface ChordMapping {
  quality: ChordSymbol["quality"];
  extension?: ChordSymbol["extension"];
}

const CHORD_QUALITY_MAP: Readonly<Record<string, ChordMapping>> = {
  major: { quality: "major" },
  minor: { quality: "minor" },
  augmented: { quality: "augmented" },
  diminished: { quality: "diminished" },
  dominant: { quality: "dominant", extension: 7 },
  "augmented-seventh": { quality: "augmented", extension: 7 },
  "major-seventh": { quality: "major", extension: 7 },
  "minor-seventh": { quality: "minor", extension: 7 },
  "diminished-seventh": { quality: "diminished", extension: 7 },
  "half-diminished": { quality: "half-diminished", extension: 7 },
  "major-minor": { quality: "minor-major", extension: 7 },
  "major-sixth": { quality: "major", extension: 6 },
  "minor-sixth": { quality: "minor", extension: 6 },
  "dominant-ninth": { quality: "dominant", extension: 9 },
  "major-ninth": { quality: "major", extension: 9 },
  "minor-ninth": { quality: "minor", extension: 9 },
  "dominant-11th": { quality: "dominant", extension: 11 },
  "major-11th": { quality: "major", extension: 11 },
  "minor-11th": { quality: "minor", extension: 11 },
  "dominant-13th": { quality: "dominant", extension: 13 },
  "major-13th": { quality: "major", extension: 13 },
  "minor-13th": { quality: "minor", extension: 13 },
  power: { quality: "power" },
  "suspended-second": { quality: "suspended2" },
  "suspended-fourth": { quality: "suspended4" },
};

function chordPitch(pitch: ChordPayload["root"]): ChordRoot {
  const step = pitch.step.toUpperCase();
  if (step.length !== 1 || !/^[A-G]$/.test(step) || !Number.isSafeInteger(pitch.alteration)) {
    throw new Error("Invalid source chord pitch while adapting Denigma chord symbols.");
  }
  return { step, ...(pitch.alteration !== 0 ? { alter: pitch.alteration } : {}) };
}

function chordPitchText(pitch: ChordRoot): string {
  return formatChordSymbolText({ position: { fraction: [0, 1] }, root: pitch });
}

function complexPresentation(chord: ChordPayload): boolean {
  return (
    chord.rootLowerCase ||
    chord.bassLowerCase === true ||
    !chord.showRoot ||
    !chord.showSuffix ||
    chord.suffix.strings.some((part) => part.position !== "inline") ||
    chord.suffix.parenthesizeDegrees ||
    chord.suffix.stackDegrees ||
    chord.suffix.hasOuterParentheses ||
    chord.suffix.hasUnrecognizedGlyphs ||
    (chord.bassArrangement !== undefined && chord.bassArrangement !== "horizontal")
  );
}

function sourceToConcert(part: JsonRecord): Interval {
  const transposition = part["transposition"];
  if (transposition === undefined) return { halfSteps: 0, staffDistance: 0 };
  const interval = isRecord(transposition) ? transposition["interval"] : undefined;
  if (
    !isRecord(interval) ||
    typeof interval["halfSteps"] !== "number" ||
    !Number.isSafeInteger(interval["halfSteps"]) ||
    typeof interval["staffDistance"] !== "number" ||
    !Number.isSafeInteger(interval["staffDistance"])
  ) {
    throw new Error("Invalid source MNX part transposition while adapting Denigma chord symbols.");
  }
  // Denigma MNX gaps classify roots AND basses in KeyContext::Written.
  // The source MNX interval is sounding→written, independent of score display mode.
  return { halfSteps: -interval["halfSteps"], staffDistance: -interval["staffDistance"] };
}

function applyDegrees(symbol: ChordSymbol, parsed: ChordSymbol, degrees: ChordPayload["suffix"]["degrees"]): void {
  if (degrees.length === 0) return;
  if (
    symbol.quality === "minor" &&
    symbol.extension === 7 &&
    parsed.quality === "half-diminished" &&
    parsed.extension === 7 &&
    degrees.length === 1 &&
    degrees[0]?.value === 5 &&
    degrees[0].alteration === -1 &&
    degrees[0].type === "alter"
  ) {
    symbol.quality = "half-diminished";
    return;
  }
  // Denigma supplies the implied degrees of suspended extensions separately,
  // with an unaltered seventh denoting the dominant seventh.
  const extension = parsed.extension;
  const expected = extension === 6 ? [6] : [7, 9, 11, 13].filter((degree) => degree <= (extension ?? 0));
  if (
    (symbol.quality === "suspended2" || symbol.quality === "suspended4") &&
    parsed.quality === symbol.quality &&
    degrees.length === expected.length &&
    expected.every((value) =>
      degrees.some(
        (degree) => degree.value === value && degree.type === "add" && degree.alteration === 0 && degree.impliedByText,
      ),
    )
  ) {
    symbol.extension = extension;
    return;
  }
  symbol.quality = "other";
}

interface FretboardConversion {
  frame?: Fretboard;
  reasons: string[];
}

type DenigmaDiagramFretboard = Extract<DenigmaFretboardPayload, { kind: "diagram" }>;

function mapFretboardCells(
  payload: DenigmaDiagramFretboard,
  reasons: string[],
): { frameNotes: Fretboard["frameNotes"]; mutedStrings: Set<number>; blankStrings: Set<number> } {
  const frameNotes: Fretboard["frameNotes"] = [];
  const seenStrings = new Set<number>();
  const mutedStrings = new Set<number>();
  const blankStrings = new Set<number>();
  for (const cell of payload.cells) {
    seenStrings.add(cell.string);
    if (cell.shape === "muted") {
      mutedStrings.add(cell.string);
      continue;
    }
    if (cell.shape === "none") {
      blankStrings.add(cell.string);
      continue;
    }
    if (cell.shape === "custom") reasons.push("Custom fretboard markers were imported as standard dots.");
    if (cell.shape === "closed" && cell.fret < 1) {
      reasons.push("Could not preserve a closed fretboard marker at fret zero.");
      continue;
    }
    frameNotes.push({
      string: cell.string,
      fret: cell.shape === "open" ? 0 : cell.fret,
      ...(cell.finger !== undefined && cell.finger > 0 ? { fingering: String(cell.finger) } : {}),
    });
  }
  for (let string = 1; string <= payload.strings; string++) {
    if (!seenStrings.has(string)) blankStrings.add(string);
  }
  return { frameNotes, mutedStrings, blankStrings };
}

interface BarreAssignment {
  note: Fretboard["frameNotes"][number];
  marker: "start" | "stop";
  isExisting: boolean;
}

function barreAssignment(
  frameNotes: Fretboard["frameNotes"],
  string: number,
  fret: number,
  marker: BarreAssignment["marker"],
): BarreAssignment | undefined {
  const notes = frameNotes.filter((note) => note.string === string);
  const atBarre = notes.find((note) => note.fret === fret);
  if (atBarre) return atBarre.barre === undefined ? { note: atBarre, marker, isExisting: true } : undefined;
  if (notes.length === 0 || notes.some((note) => note.fret < fret) || !notes.some((note) => note.fret > fret)) {
    return undefined;
  }
  return { note: { string, fret }, marker, isExisting: false };
}

function applyFretboardBarres(
  payload: DenigmaDiagramFretboard,
  frameNotes: Fretboard["frameNotes"],
  reasons: string[],
): void {
  for (const barre of payload.barres) {
    if (
      barre.fret < 1 ||
      barre.startString < 1 ||
      barre.endString > payload.strings ||
      barre.startString >= barre.endString
    ) {
      reasons.push("Could not preserve a malformed fretboard barre.");
      continue;
    }
    const startAssignment = barreAssignment(frameNotes, barre.endString, barre.fret, "start");
    const stopAssignment = barreAssignment(frameNotes, barre.startString, barre.fret, "stop");
    if (!startAssignment || !stopAssignment) {
      reasons.push("Could not preserve a barre whose endpoint string has no compatible played fret.");
      continue;
    }
    for (const assignment of [startAssignment, stopAssignment]) {
      if (assignment.isExisting) assignment.note.barre = assignment.marker;
      else frameNotes.push({ ...assignment.note, barre: assignment.marker });
    }
  }
}

function toFretboard(payload: DenigmaFretboardPayload, partId: string): FretboardConversion {
  if (payload.kind === "font") {
    return { reasons: ["Font-based chord diagrams are not supported; preserved the chord symbol."] };
  }
  if (payload.fretboardNumber < 1 || payload.fretboardNumber > 36) {
    return { reasons: ["Could not preserve a diagram with an invalid first fret; preserved the chord symbol."] };
  }
  if (payload.fretboardNumber > 1 && !payload.showFretboardNumber) {
    return {
      reasons: ["Could not preserve a hidden fret number on a shifted diagram; preserved the chord symbol."],
    };
  }
  const reasons: string[] = [];
  const { frameNotes, mutedStrings, blankStrings } = mapFretboardCells(payload, reasons);
  if (mutedStrings.size > 0 && blankStrings.size > 0) {
    reasons.push("Mixed muted and blank unplayed strings cannot be represented individually.");
  }
  applyFretboardBarres(payload, frameNotes, reasons);

  const firstFret =
    payload.fretboardNumber > 1
      ? {
          fret: payload.fretboardNumber,
          text: `${payload.fretboardNumber}${payload.fretNumberText ?? ""}`,
          location: "right" as const,
        }
      : undefined;
  const frame: Fretboard = {
    partId,
    frameStrings: payload.strings,
    frameFrets: payload.frets,
    ...(firstFret ? { firstFret } : {}),
    frameNotes,
    ...(mutedStrings.size > 0 ? { unplayed: "x" } : blankStrings.size > 0 ? { unplayed: "" } : {}),
  };
  const errors = validateFretboard(frame);
  if (errors.length > 0) {
    reasons.push(`Could not preserve chord diagram: ${[...new Set(errors)].join(" ")}`);
    return { reasons };
  }
  return { frame, reasons };
}

function toChordSymbol(
  chord: ChordPayload,
  gap: AdaptedDenigmaGap,
  interval: Interval,
  fretboard: Fretboard | undefined,
): ChordSymbol {
  if (
    gap.position !== undefined &&
    (!isRecord(gap.position) ||
      !Number.isSafeInteger(gap.position.numerator) ||
      gap.position.numerator < 0 ||
      !Number.isSafeInteger(gap.position.denominator) ||
      gap.position.denominator <= 0)
  ) {
    throw new Error("Invalid rhythmic position while adapting Denigma chord symbols.");
  }
  const position = { fraction: [gap.position?.numerator ?? 0, gap.position?.denominator ?? 1] as [number, number] };
  // Normalize both pitches before constructing semantic or display text.
  const pitches = transposeChordSymbol(
    {
      position,
      root: chordPitch(chord.root),
      ...(chord.bass ? { bass: chordPitch(chord.bass) } : {}),
    },
    interval,
  );
  const noChord = parseChordSymbolText(chord.suffix.suffixText, position);
  const fretboardFields = fretboard ? { fretboards: [fretboard] } : {};
  if (
    chord.suffix.quality === "none" &&
    !chord.showRoot &&
    !chord.bass &&
    chord.suffix.degrees.length === 0 &&
    resolveChordSymbol(noChord).status === "silent"
  ) {
    return { ...noChord, ...fretboardFields };
  }
  // Visibility and letter casing must not remove harmonic information from rawText.
  const text =
    chordPitchText(pitches.root!) + chord.suffix.suffixText + (pitches.bass ? `/${chordPitchText(pitches.bass)}` : "");
  const parsed = parseChordSymbolText(text, position);
  const mapping = chord.suffix.quality ? CHORD_QUALITY_MAP[chord.suffix.quality] : undefined;
  const symbol: ChordSymbol = {
    ...pitches,
    quality: mapping?.quality ?? "other",
    rawText: text,
    ...(chord.suffix.suffixText ? { kindText: chord.suffix.suffixText } : {}),
    ...(mapping?.extension !== undefined ? { extension: mapping.extension } : {}),
    ...fretboardFields,
  };
  applyDegrees(symbol, parsed, chord.suffix.degrees);
  // Source aliases and typography are provenance, not authored display overrides.
  return symbol;
}

function isStoredRoot(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value["step"] === "string" &&
    (value["alter"] === undefined || (typeof value["alter"] === "number" && Number.isSafeInteger(value["alter"])))
  );
}

function assertStoredChord(value: unknown): asserts value is ChordSymbol {
  if (
    !isRecord(value) ||
    !isRecord(value["position"]) ||
    !Array.isArray(value["position"]["fraction"]) ||
    value["position"]["fraction"].length !== 2 ||
    !value["position"]["fraction"].every((item) => typeof item === "number" && Number.isSafeInteger(item)) ||
    (value["root"] === undefined && typeof value["rawText"] !== "string") ||
    (value["root"] !== undefined && !isStoredRoot(value["root"])) ||
    (value["bass"] !== undefined && !isStoredRoot(value["bass"])) ||
    (value["quality"] !== undefined &&
      value["quality"] !== "other" &&
      !Object.values(CHORD_QUALITY_MAP).some((mapping) => mapping.quality === value["quality"])) ||
    (value["extension"] !== undefined && ![6, 7, 9, 11, 13].includes(value["extension"] as number)) ||
    ["rawText", "kindText", "textOverride"].some((key) => value[key] !== undefined && typeof value[key] !== "string")
  ) {
    throw new Error("Invalid existing global chord symbol while adapting Denigma gaps.");
  }
}

interface ChordOccurrence {
  gapIndex: number;
  partIndex: number;
  staff: number;
  chordSymbols: ChordSymbol[];
}

interface MeasureChords {
  target: MeasureTarget;
  sources: ChordOccurrence[];
}

function sourcePartId(part: JsonRecord): string | undefined {
  const partId = part["id"];
  return typeof partId === "string" && partId.length > 0 ? partId : undefined;
}

export function applyChordSymbolGaps(
  gaps: readonly NormalizedGap[],
  index: TargetIndex,
  diagnostics: DenigmaDiagnostic[],
  fretboards: Record<string, DenigmaFretboardPayload>,
): Map<number, GapApplication> {
  const applications = new Map<number, GapApplication>();
  const measures = new Map<number, MeasureChords>();
  gaps.forEach((gap, gapIndex) => {
    if (!isAdaptedDenigmaGap(gap) || gap.type !== "chord-symbol") return;
    if (!isChordGap(gap)) {
      applications.set(gapIndex, { outcome: { disposition: "unhandled", reason: "Malformed chord-symbol payload." } });
      return;
    }
    const target = index.measure(gap.anchor);
    if (!target?.part || target.partIndex === undefined) {
      applications.set(gapIndex, {
        outcome: { disposition: "unhandled", reason: "Chord-symbol source part is unavailable." },
      });
      return;
    }
    const partId = sourcePartId(target.part);
    if (!partId) {
      applications.set(gapIndex, {
        outcome: { disposition: "unhandled", reason: "Chord-symbol source part ID is unavailable." },
      });
      return;
    }
    if (gap.staff !== undefined && (!Number.isSafeInteger(gap.staff) || gap.staff < 1)) {
      throw new Error("Invalid source staff while adapting Denigma chord symbols.");
    }
    const fretboardPayload = gap.chord.fretboard === undefined ? undefined : fretboards[gap.chord.fretboard];
    const fretboardConversion = fretboardPayload ? toFretboard(fretboardPayload, partId) : undefined;
    const fretboard = fretboardConversion?.frame;
    const chordSymbol = toChordSymbol(gap.chord, gap, sourceToConcert(target.part), fretboard);
    const resolution = resolveChordSymbol(chordSymbol);
    const harmonyReason =
      resolution.status === "unsupported"
        ? `${resolution.message} Preserved source harmony as rawText.`
        : complexPresentation(gap.chord) && (resolution.status !== "silent" || !gap.chord.showSuffix)
          ? "Preserved full concert harmonic text for house-style rendering; Finale suffix typography and visibility fields cannot be represented."
          : undefined;
    const reason = [harmonyReason, ...(fretboardConversion?.reasons ?? [])].filter(Boolean).join(" ") || undefined;
    applications.set(gapIndex, {
      outcome: { disposition: reason ? "handled-partially" : "handled", ...(reason ? { reason } : {}) },
    });
    ensureViritura(target.part)["chordSymbolVisibility"] = "show";
    const measure = measures.get(target.measureIndex) ?? { target, sources: [] };
    measure.sources.push({
      gapIndex,
      partIndex: target.partIndex,
      staff: gap.staff ?? 1,
      chordSymbols: [chordSymbol],
    });
    measures.set(target.measureIndex, measure);
  });
  for (const { target, sources } of measures.values()) {
    const extensions = ensureViritura(target.globalMeasure);
    const existing = ensureArrayProperty(extensions, "chordSymbols").map((value) => {
      assertStoredChord(value);
      return value;
    });
    // The core merge ranks parts; stable ordering here also ranks staves within a part.
    sources.sort((a, b) => a.partIndex - b.partIndex || a.staff - b.staff || a.gapIndex - b.gapIndex);
    const merged = mergeGlobalChordSymbols({ chordSymbols: existing }, sources);
    extensions["chordSymbols"] = merged.measure.chordSymbols;
    diagnostics.push(
      ...merged.warnings.map((warning) => ({
        severity: "warning" as const,
        message: `Denigma chord-symbol gap in measure ${target.measureIndex + 1} at ${warning.position.fraction.join("/")}: ${
          warning.kind === "fretboard"
            ? `discarded a conflicting diagram for part ${warning.discardedPartIndex + 1}; kept the first diagram for that instrument.`
            : `discarded different harmony from part ${warning.discardedPartIndex + 1}; kept the topmost source staff (part ${warning.keptPartIndex + 1}).`
        }`,
      })),
    );
  }
  return applications;
}
