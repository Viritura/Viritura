import {
  expandMeasureRepeats,
  initialInstrumentState,
  listInstrumentChanges,
  resolveMeter,
  resolveStaffMeterTimeline,
  type DiagnosticCollector,
  type KeySignature,
  type Score,
  type TimeSignature,
} from "@viritura/core";
import type { ExportPart, ExportSequence, PartPlan } from "./types";
import { includesDirection, includesSequence } from "./selection";
import { add, compare, multiply, ONE, rational, timeSequence, ZERO } from "./rhythm";

export function preparePart(score: Score, original: ExportPart, diagnostics: DiagnosticCollector): PartPlan {
  original.part.measures.forEach((measure, mi) => {
    const span = measure.measureRepeat?.number;
    if (
      span !== undefined &&
      (!Number.isSafeInteger(span) || span < 1 || span > mi || mi + span > original.part.measures.length)
    ) {
      throw new Error("A measure repeat must reference an existing complete preceding passage.");
    }
  });
  const selection = {
    ...original,
    part: expandMeasureRepeats(
      original.part,
      score.global.measures.map((measure) => measure.id),
    ),
  };
  let time: TimeSignature = { count: 4, unit: 4 };
  let key: KeySignature = { fifths: 0 };
  const globalState = score.global.measures.map((global) => {
    time = global.time ?? time;
    key = global.key ?? key;
    resolveMeter(time);
    return { global, time, key };
  });
  const meters = resolveStaffMeterTimeline(
    selection.part.measures.map((measure) => measure.staffMeters),
    globalState.map((state) => state.time),
  );
  if (meters.issues.length) throw meters.issues[0]!.error;
  if (meters.table.some((row) => [...row.values()].some((meter) => meter.synchronization === "fitMeasure"))) {
    diagnostics.warn(
      `/parts/${selection.sourceIndex}`,
      "Staff-local fitted meters retain exact durations using MusicXML time modifications; their appearance may be reflowed.",
      "musicxml-fitted-meter",
    );
  }
  const voices = new Map<string, string>();
  const measures = globalState.map((state, mi) => {
    const staffMeters = meters.table[mi]!;
    const anonymousVoices = new Map<number, number>();
    const sequences: ExportSequence[] = selection.part.measures[mi]!.sequences.filter((sequence) =>
      includesSequence(selection, sequence),
    ).map((sequence) => {
      const sourceStaff = sequence.staff ?? 1;
      const ratio = staffMeters.get(sourceStaff)?.ratioToGlobal;
      const ordinal = anonymousVoices.get(sourceStaff) ?? 0;
      if (sequence.voice === undefined) anonymousVoices.set(sourceStaff, ordinal + 1);
      const identity = `${sourceStaff}:${sequence.voice ?? `anonymous-${ordinal}`}`;
      if (!voices.has(identity)) voices.set(identity, String(voices.size + 1));
      return {
        ...timeSequence(
          sequence.fullMeasure
            ? {
                ...sequence,
                content: [
                  {
                    type: "event",
                    duration: sequence.fullMeasure.visualDuration,
                    rest: { staffPosition: sequence.fullMeasure.staffPosition },
                    fermata: sequence.fullMeasure.fermata,
                  },
                ],
              }
            : sequence,
          ratio ? rational(ratio.num, ratio.den) : ONE,
        ),
        voice: voices.get(identity)!,
        sourceStaff,
        staff: selection.staves.get(sourceStaff)!,
      };
    });
    const nominal = rational(state.time.count, state.time.unit);
    let actual = ZERO;
    const pickup = mi === 0 && state.global.number === 0;
    if (pickup || state.time.display === "senzaMisura") {
      for (const part of score.parts) {
        for (const sequence of part.measures[mi]!.sequences) {
          const length = timeSequence(sequence).duration;
          if (compare(length, actual) > 0) actual = length;
        }
      }
    }
    let duration = nominal;
    if ((pickup || state.time.display === "senzaMisura") && actual.n > 0n) duration = actual;
    for (const sequence of sequences) {
      if (!sequence.sequence.fullMeasure && compare(sequence.duration, duration) > 0) {
        if (state.time.display !== "senzaMisura")
          throw new Error(`Instrument "${selection.part.name}" overfills measure ${mi + 1}.`);
        duration = sequence.duration;
      }
      if (sequence.sequence.fullMeasure) {
        const event = sequence.events[0];
        if (!event || !event.event.rest || sequence.events.length !== 1)
          throw new Error("A full-measure rest must contain exactly one rest event.");
        event.fullMeasure = true;
        event.duration = duration;
        sequence.duration = duration;
      }
    }
    if (sequences.length === 0) {
      for (const [sourceStaff, staff] of selection.staves) {
        const sequence = {
          staff: sourceStaff,
          content: [{ type: "event" as const, duration: { base: "whole" as const }, rest: {} }],
          fullMeasure: { visualDuration: { base: "whole" as const } },
        };
        const timed = timeSequence(sequence);
        timed.events[0]!.duration = duration;
        timed.events[0]!.fullMeasure = true;
        sequences.push({ ...timed, duration, sourceStaff, staff, voice: String(voices.size + staff) });
      }
    }
    return { ...state, duration, sequences, staffMeters };
  });
  const initialInstrument = initialInstrumentState(selection.part);
  const instrumentChanges = listInstrumentChanges(selection.part);
  for (const state of [initialInstrument, ...instrumentChanges.map((change) => change.state)]) {
    if (state.instrumentKey !== undefined && !state.instrument)
      throw new Error(`Unknown instrument "${state.instrumentKey}".`);
  }
  let cursor = ZERO;
  const measureStarts = measures.map((measure) => {
    const start = cursor;
    cursor = add(cursor, measure.duration);
    return start;
  });
  const measureIds = new Map(score.global.measures.map((measure, mi) => [measure.id, mi]));
  const ottavaSpans = selection.part.measures.flatMap((measure, mi) =>
    (measure.ottavas ?? [])
      .filter((ottava) => includesDirection(selection, ottava.staff ?? 1, ottava.voice))
      .map((ottava) => {
        const endIndex = measureIds.get(ottava.end.measure);
        if (endIndex === undefined) throw new Error("Ottava references a missing measure.");
        if (![-3, -2, -1, 1, 2, 3].includes(ottava.value)) throw new Error("Invalid octave-shift value.");
        const staff = ottava.staff ?? 1;
        const at = (index: number, fraction: [number, number]) => {
          const ratio = measures[index]!.staffMeters.get(staff)?.ratioToGlobal;
          return add(
            measureStarts[index]!,
            multiply(rational(...fraction), ratio ? rational(ratio.num, ratio.den) : ONE),
          );
        };
        return {
          start: at(mi, ottava.position.fraction),
          end: at(endIndex, ottava.end.position.fraction),
          staff,
          voice: ottava.voice,
          value: ottava.value,
        };
      }),
  );
  return { selection, measures, initialInstrument, instrumentChanges, measureStarts, ottavaSpans };
}
