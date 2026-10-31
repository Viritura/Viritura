import type { LyricLine, NoteEvent, SequenceContent, Score } from "../model";
import { measureBeats } from "../model/time";
import { DURATION_BEATS } from "../constants";

export interface ResolvedLyricExtender {
  sourceEventId?: string;
  targetEventId?: string;
  partIndex: number;
  sequenceIndex: number;
  lineId: string;
  startMeasure: number;
  endMeasure: number;
  startBeat: number;
  endBeat: number;
  explicit: boolean;
}

export interface LyricExtenderDiagnostic {
  code: "missing-target" | "backward-target" | "conflicting-target";
  sourceEventId?: string;
  lineId: string;
  targetEventId: string;
}

export interface LyricExtenderResolution {
  extenders: ResolvedLyricExtender[];
  diagnostics: LyricExtenderDiagnostic[];
}

export interface LyricExtenderTargetCandidate {
  eventId: string;
  partIndex: number;
  measureIndex: number;
  startBeat: number;
}

interface LocatedEvent {
  event: NoteEvent;
  partIndex: number;
  sequenceIndex: number;
  voice?: string;
  staff: number;
  measureIndex: number;
  startBeat: number;
  durationBeats: number;
  rest: boolean;
  ordinal: number;
}

function durationBeats(duration: NoteEvent["duration"]): number {
  const base = DURATION_BEATS[duration.base];
  let dots = 1;
  for (let index = 0; index < (duration.dots ?? 0); index++) dots += 0.5 ** (index + 1);
  return base * dots;
}

function quantityBeats(quantity: { duration: NoteEvent["duration"]; multiple: number }): number {
  return durationBeats(quantity.duration) * quantity.multiple;
}

function itemSpan(item: SequenceContent): number {
  if (item.type === "event") return durationBeats(item.duration);
  if (item.type === "space") return (4 * item.duration[0]) / item.duration[1];
  if (item.type === "grace") return 0;
  if (item.type === "tuplet") return quantityBeats(item.outer);
  return quantityBeats(item.outer);
}

function walkTimedContent(
  content: readonly SequenceContent[],
  startBeat: number,
  scale: number,
  partIndex: number,
  sequenceIndex: number,
  voice: string | undefined,
  staff: number,
  measureIndex: number,
  output: LocatedEvent[],
  ordinal: { value: number },
): number {
  let cursor = startBeat;
  for (const item of content) {
    if (item.type === "event") {
      const duration = durationBeats(item.duration) * scale;
      output.push({
        event: item,
        partIndex,
        sequenceIndex,
        voice,
        staff,
        measureIndex,
        startBeat: cursor,
        durationBeats: duration,
        rest: item.rest !== undefined || ((item.notes?.length ?? 0) === 0 && (item.kitNotes?.length ?? 0) === 0),
        ordinal: ordinal.value++,
      });
      cursor += duration;
      continue;
    }
    if (item.type === "space") {
      cursor += ((4 * item.duration[0]) / item.duration[1]) * scale;
      continue;
    }
    if (item.type === "grace") {
      for (const event of item.content) {
        output.push({
          event,
          partIndex,
          sequenceIndex,
          voice,
          staff,
          measureIndex,
          startBeat: cursor,
          durationBeats: 0,
          rest: event.rest !== undefined || ((event.notes?.length ?? 0) === 0 && (event.kitNotes?.length ?? 0) === 0),
          ordinal: ordinal.value++,
        });
      }
      continue;
    }
    if (item.type === "tuplet") {
      const inner = quantityBeats(item.inner);
      const ratio = inner > 0 ? quantityBeats(item.outer) / inner : 1;
      const span = walkTimedContent(
        item.content,
        cursor,
        scale * ratio,
        partIndex,
        sequenceIndex,
        voice,
        staff,
        measureIndex,
        output,
        ordinal,
      );
      cursor = Math.max(cursor + itemSpan(item) * scale, span);
      continue;
    }
    const natural = item.content.reduce((sum, event) => sum + durationBeats(event.duration), 0);
    const ratio = natural > 0 ? quantityBeats(item.outer) / natural : 1;
    const span = walkTimedContent(
      item.content,
      cursor,
      scale * ratio,
      partIndex,
      sequenceIndex,
      voice,
      staff,
      measureIndex,
      output,
      ordinal,
    );
    cursor = Math.max(cursor + itemSpan(item) * scale, span);
  }
  return cursor;
}

function collectEvents(score: Score): LocatedEvent[] {
  const offsets: number[] = [];
  let measureOffset = 0;
  const measureCount = Math.max(score.global.measures.length, ...score.parts.map((part) => part.measures.length));
  let activeMeter = { count: 4, unit: 4 };
  for (let index = 0; index < measureCount; index++) {
    const measure = score.global.measures[index];
    if (measure?.time) activeMeter = measure.time;
    offsets.push(measureOffset);
    measureOffset += measureBeats(activeMeter);
  }
  const events: LocatedEvent[] = [];
  const ordinal = { value: 0 };
  for (let partIndex = 0; partIndex < score.parts.length; partIndex++) {
    const part = score.parts[partIndex]!;
    for (let measureIndex = 0; measureIndex < part.measures.length; measureIndex++) {
      const measure = part.measures[measureIndex]!;
      const start = offsets[measureIndex] ?? measureIndex * 4;
      measure.sequences.forEach((sequence, sequenceIndex) => {
        walkTimedContent(
          sequence.content,
          start,
          1,
          partIndex,
          sequenceIndex,
          sequence.voice,
          sequence.staff ?? 1,
          measureIndex,
          events,
          ordinal,
        );
      });
    }
  }
  return events;
}

function hasLyrics(event: LocatedEvent, lineId: string): boolean {
  return event.event.lyrics?.lines?.[lineId] !== undefined;
}

function isEligibleSyllable(line: LyricLine): boolean {
  return line.type !== "start" && line.type !== "middle";
}

export function lyricExtenderTargetCandidates(score: Score, sourceEventId: string): LyricExtenderTargetCandidate[] {
  const events = collectEvents(score);
  const source = events.find((located) => located.event.id === sourceEventId);
  if (!source) return [];
  return events.flatMap((located) =>
    located.event.id && located.startBeat >= source.startBeat
      ? [
          {
            eventId: located.event.id,
            partIndex: located.partIndex,
            measureIndex: located.measureIndex,
            startBeat: located.startBeat,
          },
        ]
      : [],
  );
}

function sameLyricVoice(source: LocatedEvent, candidate: LocatedEvent): boolean {
  return (
    source.partIndex === candidate.partIndex &&
    source.staff === candidate.staff &&
    (source.voice !== undefined
      ? source.voice === candidate.voice
      : candidate.voice === undefined && source.sequenceIndex === candidate.sequenceIndex)
  );
}

function inferredTarget(
  source: LocatedEvent,
  lineId: string,
  events: readonly LocatedEvent[],
): LocatedEvent | undefined {
  const continuation = events
    .filter((event) => sameLyricVoice(source, event) && event.ordinal > source.ordinal)
    .sort((left, right) => left.ordinal - right.ordinal);
  let target: LocatedEvent | undefined;
  for (const event of continuation) {
    if (hasLyrics(event, lineId)) break;
    if (event.rest) break;
    target = event;
  }
  return target;
}

function crossesLaterSyllable(
  source: LocatedEvent,
  target: LocatedEvent,
  lineId: string,
  events: readonly LocatedEvent[],
): boolean {
  return events.some(
    (candidate) =>
      sameLyricVoice(source, candidate) &&
      candidate.ordinal > source.ordinal &&
      candidate.startBeat <= target.startBeat &&
      candidate.ordinal !== target.ordinal &&
      hasLyrics(candidate, lineId),
  );
}

export function resolveLyricExtenders(score: Score): LyricExtenderResolution {
  const events = collectEvents(score);
  const byId = new Map<string, LocatedEvent>();
  for (const event of events) {
    if (event.event.id && !byId.has(event.event.id)) byId.set(event.event.id, event);
  }

  const extenders: ResolvedLyricExtender[] = [];
  const diagnostics: LyricExtenderDiagnostic[] = [];
  const explicitPolicy = score.mnx.support?.useLyricExtenders === true;
  for (const source of events) {
    for (const [lineId, line] of Object.entries(source.event.lyrics?.lines ?? {})) {
      const explicit = line.extender !== undefined;
      if (line.extender?.show === false || (!explicit && explicitPolicy) || (!explicit && !isEligibleSyllable(line))) {
        continue;
      }

      let target: LocatedEvent | undefined;
      if (line.extender?.target !== undefined) {
        target = byId.get(line.extender.target);
        if (!target) {
          diagnostics.push({
            code: "missing-target",
            sourceEventId: source.event.id,
            lineId,
            targetEventId: line.extender.target,
          });
          continue;
        }
        if (target.startBeat < source.startBeat) {
          diagnostics.push({
            code: "backward-target",
            sourceEventId: source.event.id,
            lineId,
            targetEventId: line.extender.target,
          });
          continue;
        }
        if (
          (target.ordinal !== source.ordinal && hasLyrics(target, lineId)) ||
          crossesLaterSyllable(source, target, lineId, events)
        ) {
          diagnostics.push({
            code: "conflicting-target",
            sourceEventId: source.event.id,
            lineId,
            targetEventId: line.extender.target,
          });
          continue;
        }
      } else {
        target = inferredTarget(source, lineId, events);
      }
      if (!target) continue;
      extenders.push({
        sourceEventId: source.event.id,
        targetEventId: target.event.id,
        partIndex: source.partIndex,
        sequenceIndex: source.sequenceIndex,
        lineId,
        startMeasure: source.measureIndex,
        endMeasure: target.measureIndex,
        startBeat: source.startBeat,
        endBeat: target.startBeat + target.durationBeats,
        explicit,
      });
    }
  }
  return { extenders, diagnostics };
}
