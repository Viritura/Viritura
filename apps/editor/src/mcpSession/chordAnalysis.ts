import { pitchToMidi, walkSequenceEvents, type Pitch, type Score } from "@viritura/core";

interface ChordTemplate {
  readonly quality: string;
  readonly intervals: readonly number[];
}

const CHORD_TEMPLATES: readonly ChordTemplate[] = [
  { quality: "major seventh", intervals: [0, 4, 7, 11] },
  { quality: "dominant seventh", intervals: [0, 4, 7, 10] },
  { quality: "minor seventh", intervals: [0, 3, 7, 10] },
  { quality: "half-diminished seventh", intervals: [0, 3, 6, 10] },
  { quality: "diminished seventh", intervals: [0, 3, 6, 9] },
  { quality: "major", intervals: [0, 4, 7] },
  { quality: "minor", intervals: [0, 3, 7] },
  { quality: "diminished", intervals: [0, 3, 6] },
  { quality: "augmented", intervals: [0, 4, 8] },
  { quality: "suspended fourth", intervals: [0, 5, 7] },
  { quality: "suspended second", intervals: [0, 2, 7] },
];

export function analyzeChords(score: Score, args: unknown): Record<string, unknown> {
  const input = isObject(args) ? args : {};
  const startMeasure = readMeasure(input.startMeasure, 1, score.global.measures.length);
  const endMeasure = readMeasure(
    input.endMeasure,
    Math.min(startMeasure + 7, score.global.measures.length),
    score.global.measures.length,
  );
  if (endMeasure < startMeasure) throw new Error("endMeasure must be greater than or equal to startMeasure.");
  if (endMeasure - startMeasure + 1 > 32) throw new Error("Chord analysis is limited to 32 measures per call.");
  const requestedPartIds = readPartIds(input.partIds);
  const parts = score.parts.filter((part) => requestedPartIds === null || (part.id && requestedPartIds.has(part.id)));
  if (requestedPartIds !== null && parts.length !== requestedPartIds.size) {
    const found = new Set(parts.map((part) => part.id));
    const missing = [...requestedPartIds].filter((id) => !found.has(id));
    throw new Error(`Unknown partIds: ${missing.join(", ")}`);
  }

  const measures = [];
  for (let measureIndex = startMeasure - 1; measureIndex < endMeasure; measureIndex++) {
    const measurePitchClasses = new Set<number>();
    const chordEvents: Record<string, unknown>[] = [];
    for (const part of parts) {
      const measure = part.measures[measureIndex];
      if (!measure) continue;
      for (let voice = 0; voice < measure.sequences.length; voice++) {
        const sequence = measure.sequences[voice]!;
        for (const { event } of walkSequenceEvents(sequence.content)) {
          const pitches = event.notes?.map((note) => note.pitch) ?? [];
          for (const pitch of pitches) measurePitchClasses.add(mod12(pitchToMidi(pitch)));
          if (pitches.length < 2) continue;
          chordEvents.push({
            partId: part.id ?? null,
            partName: part.name,
            voice,
            eventId: event.id ?? null,
            pitches,
            analysis: identifyPitchCollection(pitches),
          });
        }
      }
    }
    measures.push({
      measure: measureIndex + 1,
      pitchClasses: [...measurePitchClasses].sort((a, b) => a - b).map(pitchClassName),
      chordEvents,
    });
  }
  return { startMeasure, endMeasure, measures };
}

function identifyPitchCollection(pitches: readonly Pitch[]): Record<string, unknown> {
  const midi = pitches.map(pitchToMidi);
  const pitchClasses = [...new Set(midi.map(mod12))].sort((a, b) => a - b);
  const bassPitchClass = mod12(Math.min(...midi));
  for (const rootPitchClass of pitchClasses) {
    const intervals = pitchClasses.map((pitchClass) => mod12(pitchClass - rootPitchClass)).sort((a, b) => a - b);
    const template = CHORD_TEMPLATES.find((candidate) => sameNumbers(candidate.intervals, intervals));
    if (!template) continue;
    const rootPitch = pitches.find((pitch) => mod12(pitchToMidi(pitch)) === rootPitchClass)!;
    const bassInterval = mod12(bassPitchClass - rootPitchClass);
    return {
      root: pitchName(rootPitch),
      quality: template.quality,
      symbol: chordSymbol(pitchName(rootPitch), template.quality),
      inversion: Math.max(0, template.intervals.indexOf(bassInterval)),
      confidence: 1,
    };
  }
  return { root: null, quality: "unclassified", symbol: null, inversion: null, confidence: 0 };
}

function chordSymbol(root: string, quality: string): string {
  const suffix: Record<string, string> = {
    major: "",
    minor: "m",
    diminished: "dim",
    augmented: "+",
    "major seventh": "maj7",
    "dominant seventh": "7",
    "minor seventh": "m7",
    "half-diminished seventh": "ø7",
    "diminished seventh": "dim7",
    "suspended fourth": "sus4",
    "suspended second": "sus2",
  };
  return `${root}${suffix[quality] ?? ` ${quality}`}`;
}

function pitchName(pitch: Pitch): string {
  if (!pitch.alter) return pitch.step;
  return `${pitch.step}${pitch.alter > 0 ? "#".repeat(pitch.alter) : "b".repeat(-pitch.alter)}`;
}

function pitchClassName(value: number): string {
  return ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][value]!;
}

function readMeasure(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`Measure numbers must be integers from 1 to ${maximum}.`);
  }
  return value as number;
}

function readPartIds(value: unknown): Set<string> | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    throw new Error("partIds must be an array of part ID strings.");
  }
  return new Set(value);
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
