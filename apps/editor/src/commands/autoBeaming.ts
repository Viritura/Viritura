import {
  resolveMeter,
  type Beam,
  type NoteEvent,
  type ResolvedMeter,
  type SequenceContent,
  type TimeSignature,
} from "@viritura/core";
import { generateEventId, sequenceContentBeats } from "./noteCommands";
import { primaryMetricBoundaries } from "./metricGrouping";

interface BeamEvent {
  event: NoteEvent;
  beat: number;
  inTuplet: boolean;
}

export function beamFlagCount(event: NoteEvent): number {
  switch (event.duration.base) {
    case "eighth":
      return 1;
    case "16th":
      return 2;
    case "32nd":
      return 3;
    case "64th":
      return 4;
    case "128th":
      return 5;
    case "256th":
      return 6;
    case "512th":
      return 7;
    case "1024th":
      return 8;
    default:
      return 0;
  }
}

export function ensureBeamEventId(event: NoteEvent): string {
  event.id ??= generateEventId();
  return event.id;
}

function uniformBoundaries(count: number, duration: number): number[] {
  return Array.from({ length: count + 1 }, (_, index) => index * duration);
}

function automaticBeamBoundaries(meter: ResolvedMeter, flags: number): readonly number[] {
  if (meter.source === "authored") return meter.beatBoundaries;
  if (flags === 1 && meter.count === 4 && meter.unit === 4) return [0, 2, 4];
  if (flags === 1 && meter.count === 6 && meter.unit === 4) return [0, 3, 6];
  if (flags > 1 && meter.unit === 4 && (meter.count === 4 || meter.count === 6)) {
    return uniformBoundaries(meter.count, 1);
  }
  return meter.beatBoundaries;
}

function boundaryIndex(beat: number, boundaries: readonly number[]): number {
  for (let index = 1; index < boundaries.length; index++) {
    if (beat < boundaries[index]! - 0.01) return index - 1;
  }
  return Math.max(0, boundaries.length - 2);
}

function flush(group: string[], beams: Beam[]): void {
  if (group.length >= 2) beams.push({ events: [...group] });
  group.length = 0;
}

function autoBeamRun(
  events: BeamEvent[],
  meter: ResolvedMeter,
  regionMaxFlags: ReadonlyMap<number, number>,
  excludeIds: ReadonlySet<string>,
): Beam[] {
  const beams: Beam[] = [];
  const group: string[] = [];
  let groupMaxFlags = 0;
  let pendingRest = false;
  let currentTuplet = false;
  let lastNoteBeat = 0;

  for (const item of events) {
    const event = item.event;
    const flags = beamFlagCount(event);
    const isRest = !event.notes?.length;

    if (flags > 0 && !isRest) {
      const eventId = ensureBeamEventId(event);
      if (excludeIds.has(eventId)) {
        flush(group, beams);
        groupMaxFlags = 0;
        pendingRest = false;
        continue;
      }
      const effectiveFlags = Math.max(
        regionMaxFlags.get(boundaryIndex(item.beat, primaryMetricBoundaries(meter))) ?? 0,
        groupMaxFlags,
        flags,
      );
      const beamBoundaries = automaticBeamBoundaries(meter, effectiveFlags);
      const atGroupBoundary = boundaryIndex(lastNoteBeat, beamBoundaries) !== boundaryIndex(item.beat, beamBoundaries);
      const crossedBeat =
        boundaryIndex(lastNoteBeat, meter.beatBoundaries) !== boundaryIndex(item.beat, meter.beatBoundaries);
      const atBeatAfterRest = pendingRest && crossedBeat;
      const atTupletBeat = (currentTuplet || item.inTuplet) && crossedBeat;
      if (group.length > 0 && (atGroupBoundary || atBeatAfterRest || atTupletBeat)) {
        flush(group, beams);
        groupMaxFlags = 0;
      }
      group.push(eventId);
      groupMaxFlags = Math.max(groupMaxFlags, flags);
      currentTuplet = item.inTuplet;
      lastNoteBeat = item.beat;
      pendingRest = false;
      if (event.markings?.caesura) {
        flush(group, beams);
        groupMaxFlags = 0;
      }
      continue;
    }

    if (flags > 0 && isRest) {
      if (
        group.length > 0 &&
        boundaryIndex(lastNoteBeat, meter.beatBoundaries) !== boundaryIndex(item.beat, meter.beatBoundaries)
      ) {
        flush(group, beams);
        groupMaxFlags = 0;
      }
      groupMaxFlags = Math.max(groupMaxFlags, flags);
      pendingRest = true;
      continue;
    }

    flush(group, beams);
    groupMaxFlags = 0;
    pendingRest = false;
  }

  flush(group, beams);
  return beams;
}

function collectTimedEvents(
  content: SequenceContent[],
  startBeat: number,
  scale: number,
  output: BeamEvent[],
  inTuplet = false,
): void {
  let beat = startBeat;
  for (const item of content) {
    if (item.type === "event") {
      output.push({ event: item, beat, inTuplet });
      beat += sequenceContentBeats(item) * scale;
      continue;
    }
    if (item.type === "tuplet") {
      const innerBeats = item.content.reduce((sum, child) => sum + sequenceContentBeats(child), 0);
      const outerBeats = sequenceContentBeats(item);
      collectTimedEvents(item.content, beat, innerBeats > 0 ? (scale * outerBeats) / innerBeats : scale, output, true);
    }
    beat += sequenceContentBeats(item) * scale;
  }
}

/**
 * Mirrors the Rust engraver's automatic primary-beam grouping. Behavioral
 * parity is enforced by test-fixtures/auto-beaming.json in both test suites.
 */
export function resolveAutomaticBeamGroups(
  content: SequenceContent[],
  time: TimeSignature,
  excludeIds: ReadonlySet<string>,
): Beam[] {
  const meter = resolveMeter(time);
  const beams: Beam[] = [];
  let run: BeamEvent[] = [];
  let beat = 0;
  const timedEvents: BeamEvent[] = [];
  collectTimedEvents(content, 0, 1, timedEvents);
  const regionMaxFlags = new Map<number, number>();
  const regionBoundaries = primaryMetricBoundaries(meter);
  for (const item of timedEvents) {
    if (!item.event.notes?.length) continue;
    if (item.event.id && excludeIds.has(item.event.id)) continue;
    const region = boundaryIndex(item.beat, regionBoundaries);
    regionMaxFlags.set(region, Math.max(regionMaxFlags.get(region) ?? 0, beamFlagCount(item.event)));
  }

  const flushRun = (): void => {
    beams.push(...autoBeamRun(run, meter, regionMaxFlags, excludeIds));
    run = [];
  };

  for (const item of content) {
    if (item.type === "event") {
      run.push({ event: item, beat, inTuplet: false });
      beat += sequenceContentBeats(item);
      continue;
    }
    if (item.type === "tuplet") {
      const innerBeats = item.content.reduce((sum, child) => sum + sequenceContentBeats(child), 0);
      const outerBeats = sequenceContentBeats(item);
      collectTimedEvents(item.content, beat, innerBeats > 0 ? outerBeats / innerBeats : 1, run, true);
    } else {
      flushRun();
    }
    beat += sequenceContentBeats(item);
  }
  flushRun();
  return beams;
}
