import {
  formatChordSymbolText,
  parseChordSymbolText,
  resolveChordSymbol,
  transposeChordSymbol,
  type ChordQuality,
  type ChordRoot,
  type ChordSymbol,
  type Interval,
  type RhythmicPosition,
} from "@viritura/core";
import { Fraction } from "../fraction";
import { childText, findChild, findChildren } from "../xmlHelpers";
import { durationFraction } from "./durationFraction";

interface ChordKindMapping {
  quality: ChordQuality;
  extension?: ChordSymbol["extension"];
}

const CHORD_KIND_MAP: Record<string, ChordKindMapping> = {
  major: { quality: "major" },
  minor: { quality: "minor" },
  augmented: { quality: "augmented" },
  diminished: { quality: "diminished" },
  dominant: { quality: "dominant", extension: 7 },
  "major-seventh": { quality: "major", extension: 7 },
  "minor-seventh": { quality: "minor", extension: 7 },
  "diminished-seventh": { quality: "diminished", extension: 7 },
  "augmented-seventh": { quality: "augmented", extension: 7 },
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

function readNumber(text: string, label: string): number {
  const number = Number(text);
  if (!text.trim() || !Number.isFinite(number)) throw new Error(`Invalid MusicXML harmony ${label}: ${text}`);
  return number;
}

function readRoot(parent: Element, prefix: "root" | "bass"): ChordRoot {
  const step = childText(parent, `${prefix}-step`)?.trim().toUpperCase();
  if (!step || !/^[A-G]$/.test(step)) throw new Error(`Invalid MusicXML harmony ${prefix} step`);
  const root: ChordRoot = { step };
  const alterText = childText(parent, `${prefix}-alter`);
  if (alterText !== null) {
    root.alter = readNumber(alterText, `${prefix} alteration`);
  }
  return root;
}

function readStaff(harmony: Element): number {
  const staffText = childText(harmony, "staff");
  if (staffText === null) return 1;
  const staff = readNumber(staffText, "staff");
  if (!Number.isSafeInteger(staff) || staff < 1) throw new Error("Invalid MusicXML harmony staff");
  return staff;
}

function degreeText(harmony: Element): string {
  return findChildren(harmony, "degree")
    .map((degree) => {
      const value = childText(degree, "degree-value");
      const alter = childText(degree, "degree-alter");
      const type = childText(degree, "degree-type");
      if (value === null || alter === null || type === null) throw new Error("Invalid MusicXML harmony degree");
      const number = readNumber(value, "degree value");
      if (!Number.isSafeInteger(number) || number < 1) throw new Error("Invalid MusicXML harmony degree value");
      readNumber(alter, "degree alteration");
      if (!["add", "alter", "subtract"].includes(type)) throw new Error("Invalid MusicXML harmony degree type");
      return `(${type} ${value}, alter ${alter})`;
    })
    .join("");
}

function preserveUnsupportedText(
  chord: ChordSymbol,
  harmony: Element,
  sourceKind: string,
  degrees: string,
): ChordSymbol {
  const kindText = chord.kindText ?? sourceKind;
  const numeral = findChild(harmony, "numeral")?.textContent?.trim();
  const functionText = childText(harmony, "function");
  const bassText = chord.bass ? `/${formatChordSymbolText({ position: chord.position, root: chord.bass })}` : "";
  const rawText = chord.root
    ? formatChordSymbolText({
        ...chord,
        bass: undefined,
        ...(chord.kindText === undefined ? {} : { quality: "other" }),
      }) +
      degrees +
      bassText
    : `${numeral ?? functionText ?? ""}${kindText}${degrees}${bassText}`;
  // Microtonal MusicXML is valid musical input, but the MNX chord root is integer-only.
  if (![chord.root?.alter ?? 0, chord.bass?.alter ?? 0].every(Number.isSafeInteger)) {
    return { position: chord.position, rawText };
  }
  return { ...chord, rawText, ...(degrees ? { quality: "other" } : {}) };
}

function concertChord(chord: ChordSymbol, interval?: Interval): ChordSymbol {
  if (!interval) return chord;
  const wholeRoot = (root: ChordRoot): ChordRoot => ({ ...root, alter: Math.trunc(root.alter ?? 0) });
  const result = transposeChordSymbol(
    {
      ...chord,
      ...(chord.root ? { root: wholeRoot(chord.root) } : {}),
      ...(chord.bass ? { bass: wholeRoot(chord.bass) } : {}),
    },
    { ...interval, halfSteps: Math.trunc(interval.halfSteps) },
  );
  // Preserve unsupported microtonal input as text, after normalizing its written spelling.
  for (const field of ["root", "bass"] as const) {
    const source = chord[field];
    const target = result[field];
    if (!source || !target) continue;
    const alter =
      (target.alter ?? 0) +
      ((source.alter ?? 0) - Math.trunc(source.alter ?? 0)) +
      (interval.halfSteps - Math.trunc(interval.halfSteps));
    result[field] = { step: target.step, ...(alter === 0 ? {} : { alter }) };
  }
  return result;
}

function extractChordSymbol(harmony: Element, position: RhythmicPosition, interval?: Interval): ChordSymbol {
  const rootElement = findChild(harmony, "root");
  const kindElement = findChild(harmony, "kind");
  if (!kindElement) throw new Error("Invalid MusicXML harmony: missing kind");

  const root = rootElement ? readRoot(rootElement, "root") : undefined;
  const sourceKind = kindElement.textContent?.trim() ?? "";
  if (!sourceKind) throw new Error("Invalid MusicXML harmony: empty kind");
  const kind = CHORD_KIND_MAP[sourceKind];
  const bassElement = findChild(harmony, "bass");
  const bass = bassElement ? readRoot(bassElement, "bass") : undefined;
  const degrees = degreeText(harmony);
  if (sourceKind === "none") return parseChordSymbolText("N.C.", position);

  const authoredKindText = kindElement.getAttribute("text")?.trim();
  const chord: ChordSymbol = {
    position,
    ...(root ? { root } : {}),
    quality: kind?.quality ?? "other",
  };
  if (authoredKindText || !kind) chord.kindText = authoredKindText || sourceKind;
  if (kind?.extension !== undefined) chord.extension = kind.extension;
  if (bass) chord.bass = bass;
  const concert = concertChord(chord, interval);
  if (degrees || resolveChordSymbol(concert).status === "unsupported") {
    return preserveUnsupportedText(concert, harmony, sourceKind, degrees);
  }
  return concert;
}

export interface ImportedHarmony {
  staff: number;
  chord: ChordSymbol;
}

export function extractHarmony(
  harmony: Element,
  cursor: Fraction,
  divisions: number,
  transpositions: ReadonlyMap<number, Interval>,
): ImportedHarmony {
  const offsetText = childText(harmony, "offset");
  const offset = offsetText === null ? 0 : readNumber(offsetText, "offset");
  const position = cursor.add(durationFraction(offset, divisions));
  if (position.isNegative()) throw new Error("Invalid MusicXML harmony position before measure");
  const staff = readStaff(harmony);
  const interval = transpositions.get(staff) ?? transpositions.get(0);
  return { staff, chord: extractChordSymbol(harmony, { fraction: position.toMnxFraction() }, interval) };
}

/** MusicXML transpose is written-to-sounding, unlike MNX's inverse interval. */
export function updateHarmonyTranspositions(attributes: Element, transpositions: Map<number, Interval>): void {
  for (const element of findChildren(attributes, "transpose")) {
    const halfSteps = readNumber(childText(element, "chromatic") ?? "", "chromatic transposition");
    const staffDistance = readNumber(childText(element, "diatonic") ?? "0", "diatonic transposition");
    const octaves = readNumber(childText(element, "octave-change") ?? "0", "octave transposition");
    const staff = readNumber(element.getAttribute("number") ?? "0", "transposition staff");
    if (![staffDistance, octaves, staff].every(Number.isSafeInteger) || staff < 0) {
      throw new Error("Invalid MusicXML harmony transposition");
    }
    if (staff === 0) transpositions.clear();
    transpositions.set(staff, { halfSteps: halfSteps + 12 * octaves, staffDistance: staffDistance + 7 * octaves });
  }
}
