import type { MidiEvent, MidiTimeline } from "../types";
import { TempoModel } from "../tempoModel";
import { playedSpansContinue, type PlayedMeasureSpan } from "./itinerary";

function navigationNoteKey(event: MidiEvent): string {
  return `${event.partIndex}:${event.playbackLaneId ?? event.channel}:${event.midiNote}:${event.drumKitProgram ?? ""}`;
}

function releaseUncontinuedNotes(
  activeNotes: Map<string, MidiEvent[]>,
  continuations: readonly MidiEvent[],
  time: number,
  out: MidiEvent[],
): void {
  const continued = new Set(continuations.map(navigationNoteKey));
  for (const [key, pending] of activeNotes) {
    if (continued.has(key)) continue;
    for (const onset of pending) {
      const { nominalTime, ...note } = onset;
      out.push({
        ...note,
        type: "noteOff",
        velocity: 0,
        time,
        ...(nominalTime === undefined ? {} : { onsetNominalTime: nominalTime }),
      });
    }
    pending.length = 0;
  }
}

function authoredOnsetInSpan(event: MidiEvent, start: number, end: number): boolean {
  return (
    event.type === "noteOn" &&
    event.scoreBeat !== undefined &&
    event.scoreBeat >= start - 1e-9 &&
    event.scoreBeat < end - 1e-9
  );
}

function continuousEndBeat(spans: readonly PlayedMeasureSpan[], index: number, startBeat: number): number {
  let end = startBeat + spans[index]!.endBeat;
  for (let nextIndex = index; playedSpansContinue(spans[nextIndex]!, spans[nextIndex + 1]); nextIndex++) {
    end += spans[nextIndex]!.measureBeats - spans[nextIndex]!.endBeat + spans[nextIndex + 1]!.endBeat;
  }
  return end;
}

function spanTempoMap(
  timeline: MidiTimeline,
  index: number,
  span: PlayedMeasureSpan,
  model: TempoModel,
  outputBeat: number,
): MidiTimeline["tempoMap"] {
  const entries: MidiTimeline["tempoMap"] = [
    {
      measureIndex: index,
      beatInMeasure: 0,
      timeSeconds: model.timeAtBeat(outputBeat),
      bpm: model.bpmAtBeat(outputBeat),
    },
  ];
  for (const entry of timeline.tempoMap) {
    if (
      entry.measureIndex !== index ||
      entry.beatInMeasure <= span.startBeat + 1e-9 ||
      entry.beatInMeasure >= span.endBeat - 1e-9
    )
      continue;
    const beatInMeasure = entry.beatInMeasure - span.startBeat;
    entries.push({
      ...entry,
      beatInMeasure,
      timeSeconds: model.timeAtBeat(outputBeat + beatInMeasure),
    });
  }
  return entries;
}

function translatedNominalTimes(
  event: MidiEvent,
  translate: (time: number) => number,
): Pick<MidiEvent, "nominalTime" | "onsetNominalTime"> {
  const times: Pick<MidiEvent, "nominalTime" | "onsetNominalTime"> = {};
  if (event.nominalTime !== undefined) times.nominalTime = translate(event.nominalTime);
  if (event.onsetNominalTime !== undefined) times.onsetNominalTime = translate(event.onsetNominalTime);
  return times;
}

function pairedOnsetTime(
  event: MidiEvent,
  onset: MidiEvent,
  translate: (time: number) => number,
): Pick<MidiEvent, "onsetNominalTime"> {
  if (onset.nominalTime !== undefined) return { onsetNominalTime: onset.nominalTime };
  if (event.onsetNominalTime !== undefined) return { onsetNominalTime: translate(event.onsetNominalTime) };
  return {};
}

export function realizeNavigation(
  timeline: MidiTimeline,
  spans: readonly PlayedMeasureSpan[],
  crossJumpContinuations: ReadonlyMap<number, readonly MidiEvent[]> = new Map(),
): MidiTimeline {
  const sourceSpans = spans.map((span, index) => ({
    startBeat: timeline.measureStartBeats[index]! + span.startBeat,
    endBeat: timeline.measureStartBeats[index]! + span.endBeat,
  }));
  const model = TempoModel.concatenate(timeline.model, sourceSpans);
  const events: MidiEvent[] = [];
  const measureStartBeats: number[] = [];
  const tempoMap: MidiTimeline["tempoMap"] = [];
  let outputBeat = 0;
  const activeNotes = new Map<string, MidiEvent[]>();
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index]!;
    const source = sourceSpans[index]!;
    const startTime = timeline.model.timeAtBeat(source.startBeat);
    const endTime = timeline.model.timeAtBeat(source.endBeat);
    const controllers = new Map<string, MidiEvent>();
    const segmentStart = events.length;
    measureStartBeats.push(outputBeat);
    tempoMap.push(...spanTempoMap(timeline, index, span, model, outputBeat));
    const translate = (time: number): number =>
      model.timeAtBeat(outputBeat) + Math.min(endTime - startTime, Math.max(0, time - startTime));
    for (const event of timeline.events) {
      const authoredOnset = authoredOnsetInSpan(event, source.startBeat, source.endBeat);
      if (event.time < startTime - 1e-9 && !authoredOnset) {
        if (event.type === "controlChange" || event.type === "programChange") {
          controllers.set(
            `${event.partIndex}:${event.playbackLaneId ?? event.channel}:${event.type}:${event.cc ?? ""}`,
            event,
          );
        }
        continue;
      }
      if (event.time > endTime + 1e-9 && !authoredOnset) continue;
      if (event.type === "noteOn") {
        const beat = event.scoreBeat ?? timeline.model.beatAtTime(event.time);
        if (beat < source.startBeat - 1e-9 || beat >= source.endBeat - 1e-9) continue;
        const output = {
          ...event,
          time: translate(event.time),
          ...translatedNominalTimes(event, translate),
          scoreBeat: outputBeat + beat - source.startBeat,
          scoreDurationBeats:
            event.scoreDurationBeats === undefined
              ? undefined
              : Math.min(
                  event.scoreDurationBeats,
                  continuousEndBeat(spans, index, timeline.measureStartBeats[index]!) - beat,
                ),
        };
        events.push(output);
        const key = navigationNoteKey(event);
        const pending = activeNotes.get(key) ?? [];
        pending.push(output);
        activeNotes.set(key, pending);
      } else if (event.type === "noteOff") {
        const pending = activeNotes.get(navigationNoteKey(event));
        if (!pending?.length) continue;
        const onset = pending.shift()!;
        events.push({
          ...event,
          time: translate(event.time),
          ...pairedOnsetTime(event, onset, translate),
        });
      } else if (event.time < endTime - 1e-9) {
        events.push({ ...event, time: translate(event.time) });
      }
    }
    events.splice(
      segmentStart,
      0,
      ...Array.from(controllers.values(), (event) => ({ ...event, time: model.timeAtBeat(outputBeat) })),
    );
    const next = spans[index + 1];
    const continues = playedSpansContinue(span, next);
    if (!continues) {
      releaseUncontinuedNotes(
        activeNotes,
        crossJumpContinuations.get(index + 1) ?? [],
        model.timeAtBeat(outputBeat + span.endBeat - span.startBeat, "release"),
        events,
      );
    }
    outputBeat += span.endBeat - span.startBeat;
  }
  const rank = { noteOff: 0, programChange: 1, controlChange: 2, pitchBend: 2, noteOn: 3 };
  events.sort((a, b) => a.time - b.time || rank[a.type] - rank[b.type]);
  return {
    ...timeline,
    events,
    model,
    tempoMap,
    totalBeats: outputBeat,
    duration: model.timeAtBeat(outputBeat),
    measureStartBeats,
    measureStartTimes: measureStartBeats.map((beat) => model.timeAtBeat(beat)),
    playedSpans: [...spans],
  };
}
