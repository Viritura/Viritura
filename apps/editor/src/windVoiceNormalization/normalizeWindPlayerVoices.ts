import {
  DURATION_BEATS,
  pitchToMidi,
  walkSequenceEvents,
  type Duration,
  type Note,
  type Part,
  type Score,
  type Sequence,
  type SequenceContent,
} from "@viritura/core";
import { createRest, generateEventId } from "../commands/noteCommands";
import type { TimedNoteEvent, WindVoiceConflict, WindVoiceNormalizationResult } from "./types";

export const TRITSCH_WIND_BRASS_PART_IDS = [
  "P1",
  "P2-1",
  "P2-2",
  "P3-1",
  "P3-2",
  "P4-1",
  "P4-2",
  "P5-1",
  "P5-2",
  "P6-1",
  "P6-2",
  "P7-1",
  "P7-2",
  "P7-3",
] as const;

const TARGET_PART_IDS = new Set<string>(TRITSCH_WIND_BRASS_PART_IDS);
const OBOE_MOVE_MEASURES = new Set([88, 92, 96]);

/** Normalize split Tritsch wind/brass voices without mutating the input score. */
export function normalizeWindPlayerVoices(score: Score): WindVoiceNormalizationResult<Score> {
  const result = structuredClone(score);
  applySafeOboeCorrections(result);

  for (const part of result.parts) {
    if (!part.id || !TARGET_PART_IDS.has(part.id)) continue;
    for (const measure of part.measures) {
      measure.sequences = normalizeSequences(measure.sequences);
    }
  }

  return { score: result, conflicts: analyzeWindVoiceConflicts(result) };
}

/** Return all remaining multi-note wind/brass events after safe corrections. */
export function analyzeWindVoiceConflicts(score: Score): WindVoiceConflict[] {
  const conflicts: WindVoiceConflict[] = [];
  for (const part of score.parts) {
    if (!part.id || !TARGET_PART_IDS.has(part.id)) continue;
    part.measures.forEach((measure, measureIndex) => {
      for (const sequence of measure.sequences) {
        for (const { event } of walkSequenceEvents(sequence.content)) {
          if (!event.notes || event.notes.length < 2) continue;
          conflicts.push({
            partId: part.id!,
            measure: measureIndex + 1,
            eventId: event.id ?? null,
            noteIds: event.notes.map((note) => note.id ?? null),
            pitches: event.notes.map(describeNote),
          });
        }
      }
    });
  }
  return conflicts;
}

function normalizeSequences(sequences: readonly Sequence[]): Sequence[] {
  const cleaned = sequences.map(clearStemForcing);
  const pitched = cleaned.filter(sequenceHasNotes);
  const retained =
    pitched.length > 0
      ? pitched
      : cleaned.length > 0
        ? [cleaned.find((sequence) => sequence.fullMeasure !== undefined) ?? cleaned[0]!]
        : [];
  return retained.map((sequence, index) => ({ ...sequence, voice: `v${String(index + 1)}` }));
}

function sequenceHasNotes(sequence: Sequence): boolean {
  return [...walkSequenceEvents(sequence.content)].some(({ event }) =>
    Boolean((event.notes && event.notes.length > 0) || (event.kitNotes && event.kitNotes.length > 0)),
  );
}

function clearStemForcing(sequence: Sequence): Sequence {
  const result = structuredClone(sequence);
  delete result.orient;
  clearContentStemForcing(result.content);
  return result;
}

function clearContentStemForcing(content: SequenceContent[]): void {
  for (const item of content) {
    if (item.type === "event") {
      delete item.stemDirection;
      delete item.orient;
      continue;
    }
    if (item.type === "tuplet") delete item.orient;
    if ("content" in item) clearContentStemForcing(item.content);
  }
}

function applySafeOboeCorrections(score: Score): void {
  const upper = requirePart(score, "P2-1");
  const lower = requirePart(score, "P2-2");
  moveOpeningDyadToPartner(upper, lower, 17, "C:1:5", "A:1:5", [3, 8], { base: "eighth" }, 2);
  for (const measureNumber of OBOE_MOVE_MEASURES) {
    moveLowerOboeDyadNote(upper, lower, measureNumber);
  }
  removeDuplicatedLowerOboeNote(upper, lower, 99);

  const firstTrumpet = score.parts.find((part) => part.id === "P6-1");
  const secondTrumpet = score.parts.find((part) => part.id === "P6-2");
  if (!firstTrumpet || !secondTrumpet) return;
  for (const measureNumber of [21, 29]) {
    moveOpeningDyadToPartner(
      firstTrumpet,
      secondTrumpet,
      measureNumber,
      "B:0:4",
      "D:1:5",
      [1, 4],
      { base: "quarter" },
      0,
    );
  }
}

function moveOpeningDyadToPartner(
  upper: Part,
  lower: Part,
  measureNumber: number,
  lowerPitch: string,
  upperPitch: string,
  spaceDuration: [number, number],
  eventDuration: Duration,
  restCount: number,
): void {
  const source = timedEvents(upper, measureNumber).find(
    ({ onset, event }) =>
      onset === 0 &&
      event.notes?.length === 2 &&
      event.notes.some((note) => notePitchKey(note) === lowerPitch) &&
      event.notes.some((note) => notePitchKey(note) === upperPitch),
  );
  if (!source?.event.notes) return;

  const destinationSequence = lower.measures[measureNumber - 1]?.sequences.find((sequence) => {
    const first = sequence.content[0];
    return first?.type === "space" && durationsEqual(first.duration, spaceDuration);
  });
  if (!destinationSequence) return;

  const moved = source.event.notes.find((note) => notePitchKey(note) === lowerPitch);
  const retained = source.event.notes.find((note) => notePitchKey(note) === upperPitch);
  if (!moved || !retained) return;

  source.event.notes = [retained];
  destinationSequence.content.splice(
    0,
    1,
    { type: "event", id: generateEventId(), duration: eventDuration, notes: [moved] },
    ...Array.from({ length: restCount }, () => createRest(eventDuration)),
  );
}

function durationsEqual(left: readonly number[], right: readonly number[]): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function moveLowerOboeDyadNote(upper: Part, lower: Part, measureNumber: number): void {
  const upperEvents = timedEvents(upper, measureNumber);
  const source = upperEvents.find(
    ({ onset, duration, event }) => onset === 1 && duration === 1 && event.notes?.length === 2,
  );
  if (!source?.event.notes) return;
  const destination = timedEvents(lower, measureNumber).find(
    ({ onset, duration, event }) =>
      onset === source.onset && duration === source.duration && (!event.notes || event.notes.length === 0),
  );
  if (!destination) return;

  const notes = [...source.event.notes].sort((left, right) => noteMidi(left) - noteMidi(right));
  const moved = notes[0]!;
  source.event.notes = [notes[1]!];
  destination.event.notes = [moved];
  delete destination.event.rest;
}

function removeDuplicatedLowerOboeNote(upper: Part, lower: Part, measureNumber: number): void {
  const source = timedEvents(upper, measureNumber).find(({ onset, event }) => onset === 0 && event.notes?.length === 2);
  if (!source?.event.notes) return;
  const sourcePitches = new Set(source.event.notes.map(notePitchKey));
  const partner = timedEvents(lower, measureNumber).find(
    ({ duration, event }) =>
      duration === source.duration && event.notes?.some((note) => sourcePitches.has(notePitchKey(note))),
  );
  if (!partner?.event.notes) return;
  const partnerPitches = new Set(partner.event.notes.map(notePitchKey));
  const retained = source.event.notes.filter((note) => !partnerPitches.has(notePitchKey(note)));
  if (retained.length === 1) source.event.notes = retained;
}

function timedEvents(part: Part, measureNumber: number): TimedNoteEvent[] {
  const measure = part.measures[measureNumber - 1];
  if (!measure) return [];
  return measure.sequences.flatMap((sequence) => collectTimedEvents(sequence.content));
}

function collectTimedEvents(content: readonly SequenceContent[], start = 0, scale = 1): TimedNoteEvent[] {
  const events: TimedNoteEvent[] = [];
  let onset = start;
  for (const item of content) {
    if (item.type === "event") {
      const duration = durationBeats(item.duration) * scale;
      events.push({ onset, duration, event: item });
      onset += duration;
    } else if (item.type === "tuplet") {
      const innerBeats = durationBeats(item.inner.duration) * item.inner.multiple;
      const outerBeats = durationBeats(item.outer.duration) * item.outer.multiple;
      events.push(...collectTimedEvents(item.content, onset, (scale * outerBeats) / innerBeats));
      onset += outerBeats * scale;
    } else if (item.type === "tremolo") {
      const duration = durationBeats(item.outer.duration) * item.outer.multiple * scale;
      events.push(...item.content.map((event) => ({ onset, duration, event })));
      onset += duration;
    } else if (item.type === "grace") {
      events.push(...item.content.map((event) => ({ onset, duration: 0, event })));
    } else {
      onset += (item.duration[0] / item.duration[1]) * 4 * scale;
    }
  }
  return events;
}

function durationBeats(duration: Duration): number {
  let beats = DURATION_BEATS[duration.base];
  let addition = beats / 2;
  for (let dot = 0; dot < (duration.dots ?? 0); dot += 1) {
    beats += addition;
    addition /= 2;
  }
  return beats;
}

function noteMidi(note: Note): number {
  return note.pitch ? pitchToMidi(note.pitch) : Number.NEGATIVE_INFINITY;
}

function notePitchKey(note: Note): string {
  return note.pitch ? `${note.pitch.step}:${String(note.pitch.alter ?? 0)}:${String(note.pitch.octave)}` : "unpitched";
}

function describeNote(note: Note): string {
  if (!note.pitch) return "unpitched";
  const accidental =
    note.pitch.alter === 1
      ? "#"
      : note.pitch.alter === -1
        ? "b"
        : note.pitch.alter
          ? `(${String(note.pitch.alter)})`
          : "";
  return `${note.pitch.step}${accidental}${String(note.pitch.octave)}`;
}

function requirePart(score: Score, partId: string): Part {
  const part = score.parts.find((candidate) => candidate.id === partId);
  if (!part) throw new Error(`Missing expected Tritsch wind part ${partId}.`);
  return part;
}
