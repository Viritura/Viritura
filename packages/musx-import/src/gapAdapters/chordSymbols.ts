import {
  formatChordSymbolText,
  mergeGlobalChordSymbols,
  parseChordSymbolText,
  resolveChordSymbol,
  transposeChordSymbol,
  type ChordRoot,
  type ChordSymbol,
  type Interval,
} from "@viritura/core";
import type { DenigmaDiagnostic, DenigmaGap } from "../types";
import { ensureArrayProperty, ensureViritura, type MeasureTarget, type TargetIndex } from "./targetIndex";
import { isChordGap, isRecord, type ChordPayload, type GapApplication, type JsonRecord } from "./types";

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

function chordPitchText(pitch: ChordRoot, lowerCase: boolean): string {
  const text = formatChordSymbolText({ position: { fraction: [0, 1] }, root: pitch });
  return lowerCase ? text.toLowerCase() : text;
}

function chordText(chord: ChordPayload, pitches: Pick<ChordSymbol, "root" | "bass">): string {
  const root = chord.showRoot && pitches.root ? chordPitchText(pitches.root, chord.rootLowerCase) : "";
  const suffix = chord.showSuffix ? chord.suffix.suffixText : "";
  const bass = pitches.bass ? `/${chordPitchText(pitches.bass, chord.bassLowerCase === true)}` : "";
  return `${root}${suffix}${bass}`;
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

function applyPresentation(symbol: ChordSymbol, chord: ChordPayload): void {
  if (!complexPresentation(chord)) return;
  const textOverride = chordText(chord, symbol);
  // Preserve identical source text even for unsupported music. Otherwise core
  // requires the override to agree with full harmony, not merely look like the source.
  if (textOverride === symbol.rawText || resolveChordSymbol({ ...symbol, textOverride }).status === "supported") {
    symbol.textOverride = textOverride;
  }
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
  // Denigma schema-v1 MNX gaps classify roots AND basses in KeyContext::Written.
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

function toChordSymbol(chord: ChordPayload, gap: DenigmaGap, interval: Interval): ChordSymbol {
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
  if (
    chord.suffix.quality === "none" &&
    !chord.showRoot &&
    !chord.bass &&
    chord.suffix.degrees.length === 0 &&
    resolveChordSymbol(noChord).status === "silent"
  ) {
    return noChord;
  }
  // Visibility and letter casing must not remove harmonic information from rawText.
  const text =
    chordPitchText(pitches.root!, false) +
    chord.suffix.suffixText +
    (pitches.bass ? `/${chordPitchText(pitches.bass, false)}` : "");
  const parsed = parseChordSymbolText(text, position);
  const mapping = chord.suffix.quality ? CHORD_QUALITY_MAP[chord.suffix.quality] : undefined;
  const symbol: ChordSymbol = {
    ...pitches,
    quality: mapping?.quality ?? "other",
    rawText: text,
    ...(chord.suffix.suffixText ? { kindText: chord.suffix.suffixText } : {}),
    ...(mapping?.extension !== undefined ? { extension: mapping.extension } : {}),
  };
  applyDegrees(symbol, parsed, chord.suffix.degrees);
  applyPresentation(symbol, chord);
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

export function applyChordSymbolGaps(
  gaps: readonly DenigmaGap[],
  index: TargetIndex,
  diagnostics: DenigmaDiagnostic[],
): Map<number, GapApplication> {
  const applications = new Map<number, GapApplication>();
  const measures = new Map<number, MeasureChords>();
  gaps.forEach((gap, gapIndex) => {
    if (gap.type !== "chord-symbol") return;
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
    if (gap.staff !== undefined && (!Number.isSafeInteger(gap.staff) || gap.staff < 1)) {
      throw new Error("Invalid source staff while adapting Denigma chord symbols.");
    }
    const chordSymbol = toChordSymbol(gap.chord, gap, sourceToConcert(target.part));
    const resolution = resolveChordSymbol(chordSymbol);
    const reason =
      resolution.status === "unsupported"
        ? `${resolution.message} Preserved source harmony as rawText.`
        : complexPresentation(gap.chord) && (resolution.status !== "silent" || !gap.chord.showSuffix)
          ? chordSymbol.textOverride === undefined
            ? "Preserved full concert harmonic text; omitted non-equivalent display text because Finale typography and visibility fields cannot be represented."
            : "Preserved harmonic meaning and equivalent plain display text but not Finale suffix typography or visibility fields."
          : undefined;
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
        message: `Denigma chord-symbol gap in measure ${target.measureIndex + 1} at ${warning.position.fraction.join("/")}: discarded different harmony from part ${warning.discardedPartIndex + 1}; kept the topmost source staff (part ${warning.keptPartIndex + 1}).`,
      })),
    );
  }
  return applications;
}
