import type { PerformanceEvent, PerformanceNote } from "../performanceEvents";
import type { TempoBuild } from "../tempoMap";
import { TempoModel } from "../tempoModel";
import { playedSpansContinue, type PlayedMeasureSpan } from "./itinerary";

export function realizePerformanceNavigation(
  events: readonly PerformanceEvent[],
  timing: TempoBuild,
  spans: readonly PlayedMeasureSpan[],
  crossJumpContinuations: ReadonlyMap<number, readonly PerformanceNote[]> = new Map(),
): PerformanceEvent[] {
  const intervals = spans.map((span, index) => ({
    startBeat: timing.measureStartBeats[index]! + span.startBeat,
    endBeat: timing.measureStartBeats[index]! + span.endBeat,
  }));
  const model = TempoModel.concatenate(timing.model, intervals);
  const outputStarts: number[] = [];
  let cursor = 0;
  for (const interval of intervals) {
    outputStarts.push(cursor);
    cursor += interval.endBeat - interval.startBeat;
  }
  const source: { startBeat: number; endBeat: number; firstIndex: number }[] = [];
  intervals.forEach((interval, index) => {
    const previous = spans[index - 1];
    const current = spans[index]!;
    const last = source.at(-1);
    if (
      last &&
      previous !== undefined &&
      previous.endBeat === previous.measureBeats &&
      current.startBeat === 0 &&
      previous.measureIndex + 1 === current.measureIndex
    )
      last.endBeat = interval.endBeat;
    else source.push({ ...interval, firstIndex: index });
  });
  const noteEnd = (note: PerformanceNote, index: number): number => {
    const end = note.startTime + note.duration;
    for (let current = index; current < intervals.length; current++) {
      const interval = intervals[current]!;
      const startTime = timing.model.timeAtBeat(interval.startBeat);
      const endTime = timing.model.timeAtBeat(interval.endBeat);
      const outputTime = model.timeAtBeat(outputStarts[current]!);
      if (end <= endTime + 1e-9) return outputTime + Math.min(endTime - startTime, Math.max(0, end - startTime));
      if (
        !playedSpansContinue(spans[current]!, spans[current + 1]) &&
        !crossJumpContinuations.get(current + 1)?.includes(note)
      )
        return outputTime + endTime - startTime;
    }
    return model.timeAtBeat(cursor);
  };
  const output: PerformanceEvent[] = [{ kind: "reset", time: 0 }];
  let outputBeat = 0;
  for (const interval of source) {
    const start = timing.model.timeAtBeat(interval.startBeat);
    const end = timing.model.timeAtBeat(interval.endBeat);
    const duration = interval.endBeat - interval.startBeat;
    const translate = (time: number): number =>
      model.timeAtBeat(outputBeat) + Math.min(end - start, Math.max(0, time - start));
    const states = new Map<"dynamics" | "technique", PerformanceEvent>();
    const segmentStart = output.length;
    for (const event of events) {
      if (event.kind === "reset" || event.kind === "noteOff") continue;
      if (event.time < start - 1e-9) {
        if (event.kind === "dynamics" || event.kind === "technique") states.set(event.kind, event);
        continue;
      }
      if (event.time >= end - 1e-9) break;
      if (event.kind === "noteOn") {
        let index = interval.firstIndex;
        while (index + 1 < intervals.length && event.time >= timing.model.timeAtBeat(intervals[index]!.endBeat) - 1e-9)
          index++;
        const note: PerformanceNote = {
          ...event.note,
          startTime: translate(event.time),
          duration: noteEnd(event.note, index) - translate(event.time),
        };
        output.push(
          { kind: "noteOn", time: note.startTime, note },
          { kind: "noteOff", time: note.startTime + note.duration, note },
        );
      } else {
        output.push({ ...event, time: translate(event.time) });
      }
    }
    output.splice(
      segmentStart,
      0,
      ...Array.from(states.values(), (state) => ({ ...state, time: model.timeAtBeat(outputBeat) })),
    );
    outputBeat += duration;
  }
  const rank = { reset: 0, noteOff: 1, dynamics: 2, technique: 2, noteOn: 3 };
  return output.sort((a, b) => a.time - b.time || rank[a.kind] - rank[b.kind]);
}
