import {
  formatChordSymbolText,
  parseChordSymbolText,
  resolveChordSymbol,
  resolveChordSymbolDegrees,
  transposeChordSymbol,
  type ChordSymbol,
  type DiagnosticCollector,
  type Interval,
} from "@viritura/core";
import { node, type XmlContext, type XmlElement } from "./xml";
import { CHORD_KIND_MAP } from "../convert";
import { exportableFretboard, fretboardElement } from "./fretboards";

const KINDS = new Map(
  Object.entries(CHORD_KIND_MAP).map(([kind, chord]) => [
    chord.extension === undefined ? chord.quality : `${chord.quality}:${chord.extension}`,
    kind,
  ]),
);

const DOMINANT_DEGREES: Readonly<Record<number, number>> = {
  1: 0,
  2: 2,
  3: 4,
  4: 5,
  5: 7,
  6: 9,
  7: 10,
  9: 2,
  11: 5,
  13: 9,
};
const BASE_QUALITY: Readonly<Record<string, string>> = {
  dominant: "major",
  "half-diminished": "diminished",
  "minor-major": "minor",
};

function chordDegrees(context: XmlContext, chord: ChordSymbol, kind: string): XmlElement[] {
  const degree = (value: number, alter: number, type: string) =>
    node(context, "degree", [
      node(context, "degree-value", value),
      node(context, "degree-alter", alter),
      node(context, "degree-type", type),
    ]);
  const degrees: XmlElement[] = [];
  const mapping = CHORD_KIND_MAP[kind]!;
  const base = resolveChordSymbolDegrees({ position: chord.position, root: { step: "C" }, ...mapping });
  const target = resolveChordSymbolDegrees(chord);
  for (const value of base.keys()) if (!target.has(value)) degrees.push(degree(value, 0, "subtract"));
  for (const [value, intervals] of target) {
    const existing = base.get(value)?.[0];
    const remaining = [...new Set(intervals)];
    if (existing !== undefined) {
      const unchanged = remaining.indexOf(existing);
      if (unchanged >= 0) remaining.splice(unchanged, 1);
      else {
        const first = remaining.shift();
        if (first !== undefined) degrees.push(degree(value, first - existing, "alter"));
      }
    }
    for (const interval of remaining) {
      const natural = DOMINANT_DEGREES[value];
      if (natural === undefined) throw new Error(`No MusicXML baseline for chord degree ${value}.`);
      degrees.push(degree(value, interval - natural, "add"));
    }
  }
  return degrees;
}
export function harmonyElement(
  context: XmlContext,
  original: ChordSymbol,
  interval: Interval | undefined,
  diagnostics: DiagnosticCollector,
  partId?: string,
): XmlElement {
  const projected = interval ? transposeChordSymbol(original, interval) : original;
  const frame = exportableFretboard(original, partId, diagnostics);
  const resolution = resolveChordSymbol(projected);
  if (resolution.status === "unsupported") {
    if (frame)
      diagnostics.warn(
        "",
        "Chord diagram omitted because unsupported harmony is exported as text.",
        "musicxml-frame-unsupported-harmony",
      );
    diagnostics.warn(
      "",
      "An unsupported chord symbol is retained as text rather than assigned a different harmonic meaning.",
      "musicxml-harmony-text",
    );
    return node(context, "direction", [
      node(context, "direction-type", [node(context, "words", formatChordSymbolText(projected))]),
    ]);
  }
  if (resolution.status === "silent") {
    return node(context, "harmony", [
      node(context, "root", [node(context, "root-step", "C")]),
      node(context, "kind", "none", { text: "N.C." }),
      frame ? fretboardElement(context, frame) : undefined,
    ]);
  }
  const chord = projected.root ? projected : parseChordSymbolText(projected.rawText!, projected.position);
  if (!chord.root) throw new Error("Resolved harmony has no root.");
  const quality = chord.quality ?? "major";
  const extension =
    chord.extension ?? (["dominant", "half-diminished", "minor-major"].includes(quality) ? 7 : undefined);
  const seventhKind = extension !== undefined && extension >= 7 ? KINDS.get(`${quality}:7`) : undefined;
  const kind = KINDS.get(`${quality}:${extension}`) ?? seventhKind ?? KINDS.get(BASE_QUALITY[quality] ?? quality);
  if (!kind) throw new Error(`No MusicXML chord kind for ${quality}.`);
  return node(context, "harmony", [
    node(context, "root", [
      node(context, "root-step", chord.root.step),
      chord.root.alter ? node(context, "root-alter", chord.root.alter) : undefined,
    ]),
    node(context, "kind", kind, { text: chord.kindText }),
    chord.bass
      ? node(context, "bass", [
          node(context, "bass-step", chord.bass.step),
          chord.bass.alter ? node(context, "bass-alter", chord.bass.alter) : undefined,
        ])
      : undefined,
    ...chordDegrees(context, chord, kind),
    frame ? fretboardElement(context, frame) : undefined,
  ]);
}
