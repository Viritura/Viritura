import { DURATION_BEATS } from "../../constants";
import type { HarpPedalLetter, HarpPedalTuning } from "./index";
import type { GlobalMeasure, Part, Score } from "../index";
import type { SequenceContent } from "../event";
import type { Pitch } from "../pitch";
import { measureBeats, type TimeSignature } from "../time";
import { resolveStaffMeterTimeline } from "../staffMeter";
import { isHarpInstrumentAt, resolveHarpPedalState } from "./pedalState";

const STEPS: readonly HarpPedalLetter[] = ["C", "D", "E", "F", "G", "A", "B"];
const STEP_SEMITONES: Readonly<Record<HarpPedalLetter, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export interface HarpPedalNote {
  partIndex: number;
  eventId: string;
  noteIndex: number;
  measureIndex: number;
  fraction: [number, number];
  beat: number;
  durationBeats: number;
  pitch: { step: HarpPedalLetter; octave: Pitch["octave"]; alter: number };
}

export interface HarpPedalIssue extends HarpPedalNote {
  reason: "unknown-pitch" | "unsupported-alteration" | "pedal-mismatch";
}

export interface HarpPedalAnalysis {
  notes: HarpPedalNote[];
  issues: HarpPedalIssue[];
}

type UnpositionedHarpPedalNote = Omit<HarpPedalNote, "fraction">;

function durationInBeats(duration: { base: keyof typeof DURATION_BEATS; dots?: number }): number {
  let multiplier = 1;
  for (let dot = 0; dot < (duration.dots ?? 0); dot++) multiplier += 0.5 ** (dot + 1);
  return DURATION_BEATS[duration.base] * multiplier;
}

function spaceInBeats(duration: readonly [number, number]): number {
  return (duration[0] * 4) / duration[1];
}

function tupletScale(content: Extract<SequenceContent, { type: "tuplet" }>): number {
  const inner = durationInBeats(content.inner.duration) * content.inner.multiple;
  const outer = durationInBeats(content.outer.duration) * content.outer.multiple;
  if (!(inner > 0) || !(outer > 0)) throw new RangeError("Harp pedal analysis found an invalid tuplet ratio.");
  return outer / inner;
}

export function harpPedalFractionFromNumber(value: number): [number, number] {
  if (!Number.isFinite(value)) throw new RangeError("Harp pedal positions must be finite.");
  if (value === 0) return [0, 1];
  const sign = Math.sign(value);
  let remainder = Math.abs(value);
  let numeratorBeforePrevious = 0;
  let numeratorPrevious = 1;
  let denominatorBeforePrevious = 1;
  let denominatorPrevious = 0;
  for (let iteration = 0; iteration < 32; iteration++) {
    const whole = Math.floor(remainder);
    const numerator = whole * numeratorPrevious + numeratorBeforePrevious;
    const denominator = whole * denominatorPrevious + denominatorBeforePrevious;
    if (denominator > 1_000_000_000) break;
    numeratorBeforePrevious = numeratorPrevious;
    numeratorPrevious = numerator;
    denominatorBeforePrevious = denominatorPrevious;
    denominatorPrevious = denominator;
    const fractional = remainder - whole;
    if (fractional < 1e-12) break;
    remainder = 1 / fractional;
  }
  return [sign * numeratorPrevious, denominatorPrevious];
}

function walkContent(
  content: readonly SequenceContent[],
  startBeat: number,
  scale: number,
  eventIds: Set<string>,
  partIndex: number,
  measureIndex: number,
  notes: UnpositionedHarpPedalNote[],
): number {
  let beat = startBeat;
  for (const item of content) {
    if (item.type === "space") {
      beat += spaceInBeats(item.duration) * scale;
      continue;
    }
    if (item.type === "tuplet") {
      beat = walkContent(item.content, beat, scale * tupletScale(item), eventIds, partIndex, measureIndex, notes);
      continue;
    }
    if (item.type === "grace") {
      walkContent(item.content, beat, 0, eventIds, partIndex, measureIndex, notes);
      continue;
    }
    if (item.type === "tremolo") {
      const event = item.content[0];
      if (event) appendEvent(event, beat, 0, eventIds, partIndex, measureIndex, notes);
      for (let index = 1; index < item.content.length; index++) {
        appendEvent(item.content[index]!, beat, 0, eventIds, partIndex, measureIndex, notes);
      }
      beat += durationInBeats(item.outer.duration) * item.outer.multiple * scale;
      continue;
    }
    appendEvent(item, beat, scale, eventIds, partIndex, measureIndex, notes);
    beat += durationInBeats(item.duration) * scale;
  }
  return beat;
}

function appendEvent(
  event: Extract<SequenceContent, { type: "event" }>,
  beat: number,
  scale: number,
  eventIds: Set<string>,
  partIndex: number,
  measureIndex: number,
  notes: UnpositionedHarpPedalNote[],
): void {
  if (!event.notes?.length) return;
  if (!event.id) throw new Error("Harp pedal analysis requires stable event IDs.");
  if (eventIds.has(event.id)) throw new Error(`Harp pedal analysis found duplicate event ID "${event.id}".`);
  eventIds.add(event.id);
  event.notes.forEach((note, noteIndex) => {
    notes.push({
      partIndex,
      eventId: event.id!,
      noteIndex,
      measureIndex,
      beat,
      durationBeats: durationInBeats(event.duration) * scale,
      pitch: {
        step: note.pitch.step,
        octave: note.pitch.octave,
        alter: note.pitch.alter ?? 0,
      },
    });
  });
}

function resolvedGlobalTimes(global: readonly GlobalMeasure[]): TimeSignature[] {
  let active: TimeSignature = { count: 4, unit: 4 };
  return global.map((measure) => {
    if (measure.time) active = measure.time;
    return active;
  });
}

/** Walk score pitches in written rhythmic order across every harp voice and staff. */
export function collectHarpPedalNotes(score: Score, partIndex: number): HarpPedalNote[] {
  const part = score.parts[partIndex];
  if (!part) return [];
  const timeSignatures = resolvedGlobalTimes(score.global.measures);
  const globalDurations = timeSignatures.map(measureBeats);
  const measureOffsets: number[] = [];
  for (let index = 0, offset = 0; index < globalDurations.length; index++) {
    measureOffsets.push(offset);
    offset += globalDurations[index]!;
  }
  const { table } = resolveStaffMeterTimeline(
    part.measures.map((measure) => measure.staffMeters),
    timeSignatures,
  );
  const notes: UnpositionedHarpPedalNote[] = [];
  const eventIds = new Set<string>();
  part.measures.forEach((measure, measureIndex) => {
    measure.sequences.forEach((sequence) => {
      const staff = sequence.staff ?? 1;
      const ratio = table[measureIndex]?.get(staff)?.ratioToGlobal;
      const scale = ratio ? ratio.num / ratio.den : 1;
      const offset = measureOffsets[measureIndex] ?? 0;
      walkContent(sequence.content, offset, scale, eventIds, partIndex, measureIndex, notes);
    });
  });
  return notes
    .map((note) => ({
      ...note,
      fraction: harpPedalFractionFromNumber(
        (note.beat - (measureOffsets[note.measureIndex] ?? 0)) / (globalDurations[note.measureIndex] ?? 1),
      ),
    }))
    .sort((a, b) => a.beat - b.beat || a.eventId.localeCompare(b.eventId) || a.noteIndex - b.noteIndex);
}

/** Find written noteheads incompatible with their known part-wide pedal state. */
export function analyzeHarpPedalCompatibility(score: Score, partIndex: number): HarpPedalAnalysis {
  const part = score.parts[partIndex];
  if (!part) return { notes: [], issues: [] };
  const notes = collectHarpPedalNotes(score, partIndex);
  const issues: HarpPedalIssue[] = [];
  for (const note of notes) {
    if (!isHarpInstrumentAt(part, note.measureIndex, note.fraction)) continue;
    const tuning = tuningAtBeat(part, note.measureIndex, note.fraction);
    if (!tuning) continue;
    const reason =
      Math.abs(note.pitch.alter) > 1
        ? "unsupported-alteration"
        : tuning[note.pitch.step] !== note.pitch.alter
          ? "pedal-mismatch"
          : null;
    if (reason) issues.push({ ...note, reason });
  }
  return { notes, issues };
}

function tuningAtBeat(part: Part, measureIndex: number, fraction: [number, number]): HarpPedalTuning | undefined {
  if (fraction[0] < 0) return undefined;
  return resolveHarpPedalState(part, measureIndex, fraction)?.tuning;
}

export function harpPedalSpellingMidi(note: HarpPedalNote["pitch"]): number {
  return (note.octave + 1) * 12 + STEP_SEMITONES[note.step] + note.alter;
}

export function harpPitchSpellings(midi: number): HarpPedalNote["pitch"][] {
  const spellings: HarpPedalNote["pitch"][] = [];
  for (let octave = 0; octave <= 9; octave++) {
    for (const step of STEPS) {
      const natural = (octave + 1) * 12 + STEP_SEMITONES[step];
      for (const alter of [-1, 0, 1] as const) {
        if (natural + alter === midi) spellings.push({ step, octave: octave as Pitch["octave"], alter });
      }
    }
  }
  return spellings;
}
