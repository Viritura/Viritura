import { pitchToMidi, walkSequenceEvents, type Score } from "@viritura/core";
import { sequenceEventTiming } from "../commands/noteCommandsDurations";
import { measureReference, resolveMeasureRange } from "./measureReferences";
import { pagination, selectParts } from "./queryFilters";

export function getNoteTable(score: Score, args: unknown): Record<string, unknown> {
  const input = isObject(args) ? args : {};
  const { startMeasure, endMeasure } = resolveMeasureRange(score, input, 8, 32);
  const { offset, limit } = pagination(input.offset, input.limit, 500);
  const parts = selectParts(score, input.partIds);
  if (input.includeRests !== undefined && typeof input.includeRests !== "boolean") {
    throw new Error("includeRests must be a boolean.");
  }
  const rows: Record<string, unknown>[] = [];
  let total = 0;
  const add = (row: Record<string, unknown>) => {
    if (total >= offset && rows.length < limit) rows.push(row);
    total++;
  };

  for (let measureIndex = startMeasure - 1; measureIndex < endMeasure; measureIndex++) {
    for (const part of parts) {
      const measure = part.measures[measureIndex];
      if (!measure) continue;
      measure.sequences.forEach((sequence, voice) => {
        const location = {
          ...measureReference(score, measureIndex),
          partId: part.id ?? null,
          partIndex: score.parts.indexOf(part),
          voice,
          staff: sequence.staff ?? 1,
        };
        if (sequence.fullMeasure && input.includeRests) {
          add({
            ...location,
            kind: "fullMeasureRest",
            eventId: null,
            eventPath: [],
            onsetBeat: 0,
            durationBeats: null,
            duration: sequence.fullMeasure.visualDuration,
            timing: "fullMeasure",
            notes: [],
            kitNotes: [],
          });
        }
        for (const { event, path } of walkSequenceEvents(sequence.content)) {
          if (!input.includeRests && !event.notes?.length && !event.kitNotes?.length) continue;
          add({
            ...location,
            kind: event.rest ? "rest" : "event",
            eventId: event.id ?? null,
            eventPath: path,
            ...sequenceEventTiming(sequence.content, path, event),
            duration: event.duration,
            notes: (event.notes ?? []).map((note) => ({
              id: note.id ?? null,
              pitch: note.pitch,
              soundingMidi: pitchToMidi(note.pitch),
            })),
            kitNotes: (event.kitNotes ?? []).map((note) => ({ id: note.id ?? null, kitComponent: note.kitComponent })),
          });
        }
      });
    }
  }
  return {
    startMeasure,
    endMeasure,
    offset,
    total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
    rows,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
