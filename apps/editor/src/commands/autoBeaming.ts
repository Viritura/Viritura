import type { Beam, NoteEvent, SequenceContent, TimeSignature } from "@viritura/core";
import { generateEventId, sequenceContentBeats } from "./noteCommands";

interface BeamEvent {
  event: NoteEvent;
  beat: number;
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

function beamGroupDuration(time: TimeSignature, flags: number): number {
  const compound = time.unit === 8 && time.count % 3 === 0;
  if (compound) return (3 * 4) / time.unit;
  if (time.unit === 8) return 1;
  const beat = 4 / time.unit;
  if (flags === 1 && time.count === 4 && time.unit === 4) return 2;
  if (flags === 1 && time.count === 6 && time.unit === 4) return 3;
  return beat;
}

function sensitivityRegionDuration(time: TimeSignature): number {
  const measureDuration = (time.count * 4) / time.unit;
  return time.count % 2 === 0 ? measureDuration / 2 : measureDuration;
}

function sensitivityRegion(beat: number, time: TimeSignature): number {
  return Math.floor((beat + 0.0001) / sensitivityRegionDuration(time));
}

function isBoundary(beat: number, groupDuration: number): boolean {
  if (groupDuration <= 0) return false;
  const ratio = beat / groupDuration;
  return Math.abs(ratio - Math.round(ratio)) < 0.01;
}

function flush(group: string[], beams: Beam[]): void {
  if (group.length >= 2) beams.push({ events: [...group] });
  group.length = 0;
}

function autoBeamRun(
  events: BeamEvent[],
  time: TimeSignature,
  regionMaxFlags: ReadonlyMap<number, number>,
  excludeIds: ReadonlySet<string>,
): Beam[] {
  const beams: Beam[] = [];
  const group: string[] = [];
  let groupMaxFlags = 0;
  let pendingRest = false;

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
        regionMaxFlags.get(sensitivityRegion(item.beat, time)) ?? 0,
        groupMaxFlags,
        flags,
      );
      const atGroupBoundary = isBoundary(item.beat, beamGroupDuration(time, effectiveFlags));
      const atBeatAfterRest = pendingRest && isBoundary(item.beat, 4 / time.unit);
      if (group.length > 0 && (atGroupBoundary || atBeatAfterRest)) {
        flush(group, beams);
        groupMaxFlags = 0;
      }
      group.push(eventId);
      groupMaxFlags = Math.max(groupMaxFlags, flags);
      pendingRest = false;
      if (event.markings?.caesura) {
        flush(group, beams);
        groupMaxFlags = 0;
      }
      continue;
    }

    if (flags > 0 && isRest) {
      if (group.length > 0 && isBoundary(item.beat, 4 / time.unit)) {
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

function collectTimedEvents(content: SequenceContent[], startBeat: number, scale: number, output: BeamEvent[]): void {
  let beat = startBeat;
  for (const item of content) {
    if (item.type === "event") {
      output.push({ event: item, beat });
      beat += sequenceContentBeats(item) * scale;
      continue;
    }
    if (item.type === "tuplet") {
      const innerBeats = item.content.reduce((sum, child) => sum + sequenceContentBeats(child), 0);
      const outerBeats = sequenceContentBeats(item);
      collectTimedEvents(item.content, beat, innerBeats > 0 ? (scale * outerBeats) / innerBeats : scale, output);
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
  const beams: Beam[] = [];
  let run: BeamEvent[] = [];
  let beat = 0;
  const timedEvents: BeamEvent[] = [];
  collectTimedEvents(content, 0, 1, timedEvents);
  const regionMaxFlags = new Map<number, number>();
  for (const item of timedEvents) {
    if (!item.event.notes?.length) continue;
    if (item.event.id && excludeIds.has(item.event.id)) continue;
    const region = sensitivityRegion(item.beat, time);
    regionMaxFlags.set(region, Math.max(regionMaxFlags.get(region) ?? 0, beamFlagCount(item.event)));
  }

  const flushRun = (): void => {
    beams.push(...autoBeamRun(run, time, regionMaxFlags, excludeIds));
    run = [];
  };

  for (const item of content) {
    if (item.type === "event") {
      run.push({ event: item, beat });
      beat += sequenceContentBeats(item);
      continue;
    }
    flushRun();
    if (item.type === "tuplet") {
      const tupletEvents: BeamEvent[] = [];
      const innerBeats = item.content.reduce((sum, child) => sum + sequenceContentBeats(child), 0);
      const outerBeats = sequenceContentBeats(item);
      collectTimedEvents(item.content, beat, innerBeats > 0 ? outerBeats / innerBeats : 1, tupletEvents);
      beams.push(...autoBeamRun(tupletEvents, time, regionMaxFlags, excludeIds));
    }
    beat += sequenceContentBeats(item);
  }
  flushRun();
  return beams;
}
