import type { Duration, Score } from "@viritura/core";
import { durationToBeats } from "../../commands/noteCommands";
import { resolveCondensedEventTargets } from "../../score/condensedWriteback";
import { resolveEventLocation, type EventLocation } from "../../score/ElementPath";
import type { SelectionState } from "../../store/selectionStore";

export interface SpannerPositions {
  readonly start: EventLocation;
  readonly targets: readonly EventLocation[];
  readonly position: { readonly fraction: [number, number] };
  readonly end: {
    readonly measure: string;
    readonly position: { readonly fraction: [number, number] };
  };
}

function beatToFraction(beat: number): [number, number] {
  let numerator = beat;
  let denominator = 4;
  while (Math.abs(numerator - Math.round(numerator)) > 1e-9 && denominator < 4096) {
    numerator *= 2;
    denominator *= 2;
  }
  return [Math.round(numerator), denominator];
}

export function eventPositionFraction(score: Score, location: EventLocation, includeEvent = false): [number, number] {
  const measure = score.parts[location.partIndex]?.measures[location.measureIndex];
  const sequence = measure?.sequences?.[location.sequenceIndex];
  let beat = 0;
  const eventLimit = location.eventIndex + (includeEvent ? 1 : 0);
  if (sequence) {
    for (let index = 0; index < eventLimit && index < sequence.content.length; index++) {
      const event = sequence.content[index];
      if (event && "duration" in event) beat += durationToBeats(event.duration as Duration);
    }
  }
  return beatToFraction(beat);
}

export function resolveSpannerPositions(
  score: Score,
  selection: SelectionState,
  selectedScoreIndex: number,
): SpannerPositions | null {
  const startId =
    selection.kind === "single" ? selection.elementId : selection.kind === "range" ? selection.startElementId : null;
  if (!startId) return null;
  let start = resolveEventLocation(startId, score);
  if (!start) return null;

  let finish = selection.kind === "range" ? resolveEventLocation(selection.endElementId, score) : null;
  if (
    finish &&
    (finish.measureIndex < start.measureIndex ||
      (finish.measureIndex === start.measureIndex && finish.eventIndex < start.eventIndex))
  ) {
    [start, finish] = [finish, start];
  }

  const startMeasureId = score.global.measures[start.measureIndex]?.id ?? `m${start.measureIndex}`;
  let endMeasureId = startMeasureId;
  let endFraction: [number, number];
  if (finish) {
    endMeasureId = score.global.measures[finish.measureIndex]?.id ?? `m${finish.measureIndex}`;
    endFraction = eventPositionFraction(score, finish, true);
  } else {
    let measureBeats = 4;
    for (let measureIndex = start.measureIndex; measureIndex >= 0; measureIndex--) {
      const time = score.global.measures[measureIndex]?.time;
      if (time) {
        measureBeats = (time.count * 4) / time.unit;
        break;
      }
    }
    endFraction = beatToFraction(measureBeats);
  }

  return {
    start,
    targets: resolveCondensedEventTargets(score, selectedScoreIndex, start),
    position: { fraction: eventPositionFraction(score, start) },
    end: { measure: endMeasureId, position: { fraction: endFraction } },
  };
}
