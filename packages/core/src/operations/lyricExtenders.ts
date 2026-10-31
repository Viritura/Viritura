import type { LyricLine, NoteEvent, SequenceContent, Score } from "../model";
import { isRest, resolveSequenceEvent, walkSequenceEvents } from "../model";
import { current, isDraft } from "immer";
import { measureBeats, type TimeSignature } from "../model/time";
import { DURATION_BEATS } from "../constants";
import { ratioToNumber, resolveStaffMeterTimeline } from "../model/staffMeter";

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
  partIndex: number;
  measureIndex: number;
  sequenceIndex: number;
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

/** Remap authored endpoints without changing visibility, inference policy, or global attributes. */
export function remapLyricExtenderTargets(
  content: readonly SequenceContent[],
  replacements: ReadonlyMap<string, string>,
): void {
  if (!hasChangedReplacement(replacements)) return;
  applyLyricTargetUpdates(content, planLyricTargetUpdates(content, replacements));
}

export function remapScoreLyricExtenderTargets(score: Score, replacements: ReadonlyMap<string, string>): void {
  if (!hasChangedReplacement(replacements)) return;
  const snapshot = isDraft(score) ? current(score) : score;
  for (const [partIndex, part] of snapshot.parts.entries()) {
    for (const [measureIndex, measure] of part.measures.entries()) {
      for (const [sequenceIndex, sequence] of measure.sequences.entries()) {
        const updates = planLyricTargetUpdates(sequence.content, replacements);
        if (!updates) continue;
        const content = score.parts[partIndex]!.measures[measureIndex]!.sequences[sequenceIndex]!.content;
        applyLyricTargetUpdates(content, updates);
      }
    }
  }
}

interface LyricTargetUpdate {
  path: readonly number[];
  lineId: string;
  target: string;
}

function hasLyricTargets(event: NoteEvent): boolean {
  const lines = event.lyrics?.lines;
  return lines !== undefined && Object.values(lines).some((line) => line.extender?.target !== undefined);
}

function remappedTarget(target: string, replacements: ReadonlyMap<string, string>): string | undefined {
  if (!replacements.has(target)) return undefined;
  let replacement = target;
  const visited = new Set<string>();
  while (replacements.has(replacement) && !visited.has(replacement)) {
    visited.add(replacement);
    const next = replacements.get(replacement)!;
    if (next === replacement) break;
    replacement = next;
  }
  if (replacement === target || (visited.has(replacement) && replacements.get(replacement) !== replacement))
    return undefined;
  return replacement;
}

function planLyricTargetUpdates(
  content: readonly SequenceContent[],
  replacements: ReadonlyMap<string, string>,
): LyricTargetUpdate[] | undefined {
  let updates: LyricTargetUpdate[] | undefined;
  for (const { event, path } of walkSequenceEvents(content, undefined, hasLyricTargets)) {
    for (const [lineId, line] of Object.entries(event.lyrics?.lines ?? {})) {
      const target = line.extender?.target;
      if (target === undefined) continue;
      const replacement = remappedTarget(target, replacements);
      if (replacement === undefined) continue;
      (updates ??= []).push({ path, lineId, target: replacement });
    }
  }
  return updates;
}

function applyLyricTargetUpdates(
  content: readonly SequenceContent[],
  updates: readonly LyricTargetUpdate[] | undefined,
): void {
  if (!updates) return;
  for (const update of updates) {
    const extender = resolveSequenceEvent(content, update.path)?.lyrics?.lines?.[update.lineId]?.extender;
    if (extender) extender.target = update.target;
  }
}

function hasChangedReplacement(replacements: ReadonlyMap<string, string>): boolean {
  for (const [source, target] of replacements) {
    if (source !== target) return true;
  }
  return false;
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
        rest: isRest(item),
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
          rest: isRest(event),
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
      cursor = span;
      continue;
    }
    const subdivision = item.content.length ? (quantityBeats(item.outer) * scale) / item.content.length : 0;
    for (const event of item.content) {
      output.push({
        event,
        partIndex,
        sequenceIndex,
        voice,
        staff,
        measureIndex,
        startBeat: cursor,
        durationBeats: subdivision,
        rest: isRest(event),
        ordinal: ordinal.value++,
      });
      cursor += subdivision;
    }
  }
  return cursor;
}

function collectEvents(score: Score): LocatedEvent[] {
  const offsets: number[] = [];
  let measureOffset = 0;
  const measureCount = Math.max(score.global.measures.length, ...score.parts.map((part) => part.measures.length));
  let activeMeter = { count: 4, unit: 4 };
  const meters: TimeSignature[] = [];
  for (let index = 0; index < measureCount; index++) {
    const measure = score.global.measures[index];
    if (measure?.time) activeMeter = measure.time;
    meters.push(activeMeter);
    offsets.push(measureOffset);
    measureOffset += measureBeats(activeMeter);
  }
  const events: LocatedEvent[] = [];
  const writtenSpans = Array<number>(measureCount).fill(0);
  const ordinal = { value: 0 };
  for (let partIndex = 0; partIndex < score.parts.length; partIndex++) {
    const part = score.parts[partIndex]!;
    const { table } = resolveStaffMeterTimeline(
      part.measures.map((measure) => measure.staffMeters),
      meters,
    );
    for (let measureIndex = 0; measureIndex < part.measures.length; measureIndex++) {
      const measure = part.measures[measureIndex]!;
      const start = offsets[measureIndex] ?? measureIndex * 4;
      measure.sequences.forEach((sequence, sequenceIndex) => {
        if (sequence.fullMeasure) {
          events.push({
            event: { type: "event", duration: sequence.fullMeasure.visualDuration, rest: {} },
            partIndex,
            sequenceIndex,
            voice: sequence.voice,
            staff: sequence.staff ?? 1,
            measureIndex,
            startBeat: start,
            durationBeats: measureBeats(meters[measureIndex]!),
            rest: true,
            ordinal: ordinal.value++,
          });
          return;
        }
        const end = walkTimedContent(
          sequence.content,
          start,
          table[measureIndex]?.get(sequence.staff ?? 1)
            ? ratioToNumber(table[measureIndex]!.get(sequence.staff ?? 1)!.ratioToGlobal)
            : 1,
          partIndex,
          sequenceIndex,
          sequence.voice,
          sequence.staff ?? 1,
          measureIndex,
          events,
          ordinal,
        );
        if (!sequence.fullMeasure) writtenSpans[measureIndex] = Math.max(writtenSpans[measureIndex]!, end - start);
      });
    }
  }
  let correction = 0;
  const corrections: number[] = [];
  for (let index = 0; index < measureCount; index++) {
    const nominal = measureBeats(meters[index]!);
    const measure = score.global.measures[index];
    const written = writtenSpans[index]!;
    corrections.push(correction);
    if (index === 0 && measure?.number === 0 && written > 0) correction += written - nominal;
    else if (measure?.time?.display === "senzaMisura") correction += Math.max(nominal, written) - nominal;
  }
  for (const event of events) event.startBeat += corrections[event.measureIndex]!;
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
    located.event.id && located.startBeat >= source.startBeat - 1e-9
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
      candidate.startBeat <= target.startBeat + 1e-9 &&
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
            partIndex: source.partIndex,
            measureIndex: source.measureIndex,
            sequenceIndex: source.sequenceIndex,
          });
          continue;
        }
        if (target.startBeat < source.startBeat - 1e-9) {
          diagnostics.push({
            code: "backward-target",
            sourceEventId: source.event.id,
            lineId,
            targetEventId: line.extender.target,
            partIndex: source.partIndex,
            measureIndex: source.measureIndex,
            sequenceIndex: source.sequenceIndex,
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
            partIndex: source.partIndex,
            measureIndex: source.measureIndex,
            sequenceIndex: source.sequenceIndex,
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
