import type { Beam, NoteEvent, Score, SequenceContent, TimeSignature } from "@viritura/core";
import { walkSequenceEvents } from "@viritura/core";
import type { EventLocation } from "../score/ElementPath";
import type { Selection } from "../store/selectionStore";
import { resolveSelectionEvents } from "../store/selectionUtils";
import { planSelectionWriteback, resolveCondensedEventTargets } from "../score/condensedWriteback";
import { generateEventId, getEffectiveTimeSignature, sequenceContentBeats } from "./noteCommands";

interface BeamEvent {
  event: NoteEvent;
  beat: number;
}

function flagCount(event: NoteEvent): number {
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

function eventAtLocation(score: Score, loc: EventLocation): NoteEvent | null {
  const content = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex]?.content;
  if (!content) return null;
  if (loc.tupletIndex === undefined) {
    const item = content[loc.eventIndex];
    return item?.type === "event" ? item : null;
  }
  const container = content[loc.tupletIndex];
  if (container?.type !== "tuplet" && container?.type !== "tremolo") return null;
  const item = container.content[loc.eventIndex];
  return item?.type === "event" ? item : null;
}

function selectedTarget(score: Score, selection: Selection): { loc: EventLocation; event: NoteEvent } | null {
  const locations = resolveSelectionEvents(selection, score);
  for (let index = locations.length - 1; index >= 0; index--) {
    const loc = locations[index]!;
    const event = eventAtLocation(score, loc);
    if (event?.notes?.length) return { loc, event };
  }
  return null;
}

interface BeamSelection {
  readonly partIndex: number;
  readonly measureIndex: number;
  readonly sequenceIndex: number;
  readonly locations: readonly EventLocation[];
}

function beamableEventSelection(score: Score, locations: readonly EventLocation[]): BeamSelection | null {
  if (locations.length < 2) return null;

  const orderedLocations = [...locations].sort((a, b) => a.eventIndex - b.eventIndex);
  const first = orderedLocations[0]!;
  if (
    orderedLocations.some(
      (loc) =>
        loc.partIndex !== first.partIndex ||
        loc.measureIndex !== first.measureIndex ||
        loc.sequenceIndex !== first.sequenceIndex ||
        loc.tupletIndex !== undefined,
    )
  ) {
    return null;
  }

  let previousEventIndex = first.eventIndex - 1;
  for (const loc of orderedLocations) {
    if (loc.eventIndex !== previousEventIndex + 1) return null;
    const event = eventAtLocation(score, loc);
    if (!event?.notes?.length || flagCount(event) === 0) return null;
    previousEventIndex = loc.eventIndex;
  }

  return {
    partIndex: first.partIndex,
    measureIndex: first.measureIndex,
    sequenceIndex: first.sequenceIndex,
    locations: orderedLocations,
  };
}

function selectedBeamableEvents(score: Score, selection: Selection): BeamSelection | null {
  return selection.kind === "range" ? beamableEventSelection(score, resolveSelectionEvents(selection, score)) : null;
}

function beamSelectionIds(score: Score, selection: BeamSelection, createMissingIds: boolean): string[] | null {
  const ids: string[] = [];
  for (const loc of selection.locations) {
    const event = eventAtLocation(score, loc);
    if (!event) return null;
    const eventId = createMissingIds ? ensureEventId(event) : event.id;
    if (!eventId) return null;
    ids.push(eventId);
  }
  return ids;
}

function beamSelectionsForWriteback(
  score: Score,
  selection: Selection,
  selectedScoreIndex?: number,
): BeamSelection[] | null {
  const visualSelection = selectedBeamableEvents(score, selection);
  if (!visualSelection) return null;
  if (selectedScoreIndex === undefined) return [visualSelection];

  const targets = planSelectionWriteback(score, selection, selectedScoreIndex).sourceEvents;
  const locationsByVoice = new Map<string, EventLocation[]>();
  for (const loc of targets) {
    const key = `${loc.partIndex}/${loc.measureIndex}/${loc.sequenceIndex}`;
    const locations = locationsByVoice.get(key) ?? [];
    locations.push(loc);
    locationsByVoice.set(key, locations);
  }
  const sourceSelections = [...locationsByVoice.values()].map((locations) => beamableEventSelection(score, locations));
  return sourceSelections.every((sourceSelection): sourceSelection is BeamSelection => sourceSelection !== null)
    ? sourceSelections
    : null;
}

export function canBeamTogetherSelection(
  score: Score | null,
  selection: Selection,
  selectedScoreIndex?: number,
): boolean {
  if (!score) return false;
  const selected = beamSelectionsForWriteback(score, selection, selectedScoreIndex);
  if (!selected) return false;
  return selected.every((sourceSelection) => {
    const measure = score.parts[sourceSelection.partIndex]?.measures[sourceSelection.measureIndex];
    const eventIds = beamSelectionIds(score, sourceSelection, false);
    return (
      measure !== undefined &&
      (eventIds === null ||
        !measure.beams?.some(
          (beam) =>
            beam.events.length === eventIds.length &&
            beam.events.every((eventId, index) => eventId === eventIds[index]),
        ))
    );
  });
}

export function canBreakBeamAfterSelection(score: Score | null, selection: Selection): boolean {
  if (!score) return false;
  const target = selectedTarget(score, selection);
  if (!target || flagCount(target.event) === 0) return false;
  const targetId = target.event.id;
  if (!targetId) return true;

  const explicitOwner = findExplicitBeamOwner(score, target.loc.partIndex, targetId);
  if (explicitOwner) return splitBeamGroup(explicitOwner.beams, targetId) !== null;

  const measure = score.parts[target.loc.partIndex]?.measures[target.loc.measureIndex];
  if (!measure || measure.beams !== undefined || score.mnx.support?.useBeams === true) return false;
  const time = getEffectiveTimeSignature(score, target.loc.measureIndex);
  const excludedIds = explicitBeamIds(score, target.loc.partIndex);
  const sequences = structuredClone(measure.sequences);
  const materialized = sequences.flatMap((sequence) => autoBeamSequence(sequence.content, time, excludedIds));
  return splitBeamGroup(materialized, targetId) !== null;
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

function isBoundary(beat: number, groupDuration: number): boolean {
  if (groupDuration <= 0) return false;
  const ratio = beat / groupDuration;
  return Math.abs(ratio - Math.round(ratio)) < 0.01;
}

function ensureEventId(event: NoteEvent): string {
  event.id ??= generateEventId();
  return event.id;
}

function flush(group: string[], beams: Beam[]): void {
  if (group.length >= 2) beams.push({ events: [...group] });
  group.length = 0;
}

function autoBeamRun(
  events: BeamEvent[],
  time: TimeSignature,
  voiceMaxFlags: number,
  excludeIds: ReadonlySet<string>,
): Beam[] {
  const beams: Beam[] = [];
  const group: string[] = [];
  let groupMaxFlags = 0;
  let pendingRest = false;

  for (const item of events) {
    const event = item.event;
    const flags = flagCount(event);
    const isRest = !event.notes?.length;

    if (flags > 0 && !isRest) {
      const eventId = ensureEventId(event);
      if (excludeIds.has(eventId)) {
        flush(group, beams);
        groupMaxFlags = 0;
        pendingRest = false;
        continue;
      }
      const effectiveFlags = Math.max(voiceMaxFlags, groupMaxFlags, flags);
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

function autoBeamSequence(content: SequenceContent[], time: TimeSignature, excludeIds: ReadonlySet<string>): Beam[] {
  const beams: Beam[] = [];
  let run: BeamEvent[] = [];
  let beat = 0;
  const voiceMaxFlags = Array.from(walkSequenceEvents(content)).reduce((max, item) => {
    return item.event.notes?.length ? Math.max(max, flagCount(item.event)) : max;
  }, 0);

  const flushRun = (): void => {
    beams.push(...autoBeamRun(run, time, voiceMaxFlags, excludeIds));
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
      beams.push(...autoBeamRun(tupletEvents, time, voiceMaxFlags, excludeIds));
    }
    beat += sequenceContentBeats(item);
  }
  flushRun();
  return beams;
}

function filterNestedBeam(beam: Beam, allowed: Set<string>): Beam | null {
  const events = beam.events.filter((id) => allowed.has(id));
  if (events.length === 0) return null;
  const nested = beam.beams?.map((child) => filterNestedBeam(child, allowed)).filter((child) => child !== null);
  return {
    events,
    ...(nested && nested.length > 0 ? { beams: nested } : {}),
    ...(beam.direction !== undefined ? { direction: beam.direction } : {}),
  };
}

function splitBeamGroup(beams: Beam[], targetId: string): Beam[] | null {
  const groupIndex = beams.findIndex((beam) => beam.events.includes(targetId));
  if (groupIndex < 0) return null;
  const group = beams[groupIndex]!;
  const eventIndex = group.events.indexOf(targetId);
  if (eventIndex < 0 || eventIndex === group.events.length - 1) return null;

  const leftIds = new Set(group.events.slice(0, eventIndex + 1));
  const rightIds = new Set(group.events.slice(eventIndex + 1));
  const replacement: Beam[] = [];
  const left = filterNestedBeam(group, leftIds);
  const right = filterNestedBeam(group, rightIds);
  if (left && left.events.length >= 2) replacement.push(left);
  if (right && right.events.length >= 2) replacement.push(right);

  return [...beams.slice(0, groupIndex), ...replacement, ...beams.slice(groupIndex + 1)];
}

function removeEventsFromBeamGroup(beam: Beam, removedIds: ReadonlySet<string>): Beam[] {
  const remainingGroups: Beam[] = [];
  let run: string[] = [];

  const flush = (): void => {
    if (run.length >= 2) {
      const retained = filterNestedBeam(beam, new Set(run));
      if (retained) remainingGroups.push(retained);
    }
    run = [];
  };

  for (const eventId of beam.events) {
    if (removedIds.has(eventId)) {
      flush();
    } else {
      run.push(eventId);
    }
  }
  flush();
  return remainingGroups;
}

function explicitBeamIds(score: Score, partIndex: number): Set<string> {
  const ids = new Set<string>();
  for (const measure of score.parts[partIndex]?.measures ?? []) {
    for (const beam of measure.beams ?? []) {
      for (const id of beam.events) ids.add(id);
    }
  }
  return ids;
}

function findExplicitBeamOwner(
  score: Score,
  partIndex: number,
  targetId: string,
): { measureIndex: number; beams: Beam[] } | null {
  const measures = score.parts[partIndex]?.measures ?? [];
  for (let measureIndex = 0; measureIndex < measures.length; measureIndex++) {
    const beams = measures[measureIndex]?.beams;
    if (beams?.some((beam) => beam.events.includes(targetId))) return { measureIndex, beams };
  }
  return null;
}

/**
 * Break the beam after the last note covered by the selection.
 *
 * Returns true when a connected beam group was split. The score is mutated so
 * callers can apply the command inside their existing Immer transaction.
 */
function breakBeamAfterLocation(score: Score, target: { loc: EventLocation; event: NoteEvent }): boolean {
  if (!target || flagCount(target.event) === 0) return false;

  const measure = score.parts[target.loc.partIndex]?.measures[target.loc.measureIndex];
  if (!measure) return false;

  const targetId = ensureEventId(target.event);
  const explicitOwner = findExplicitBeamOwner(score, target.loc.partIndex, targetId);
  if (explicitOwner) {
    const split = splitBeamGroup(explicitOwner.beams, targetId);
    if (!split) return false;
    score.parts[target.loc.partIndex]!.measures[explicitOwner.measureIndex]!.beams = split;
    return true;
  }

  if (measure.beams !== undefined) return false;
  if (score.mnx.support?.useBeams === true) return false;
  const time = getEffectiveTimeSignature(score, target.loc.measureIndex);
  const excludedIds = explicitBeamIds(score, target.loc.partIndex);
  const materialized = measure.sequences.flatMap((sequence) => autoBeamSequence(sequence.content, time, excludedIds));
  const split = splitBeamGroup(materialized, targetId);
  if (!split) return false;
  measure.beams = split;
  return true;
}

export function breakBeamAfterSelection(score: Score, selection: Selection, selectedScoreIndex?: number): boolean {
  const target = selectedTarget(score, selection);
  if (!target) return false;
  const locations =
    selectedScoreIndex === undefined
      ? [target.loc]
      : resolveCondensedEventTargets(score, selectedScoreIndex, target.loc);
  let changed = false;
  for (const loc of locations) {
    const event = eventAtLocation(score, loc);
    if (event) changed = breakBeamAfterLocation(score, { loc, event }) || changed;
  }
  return changed;
}

export function beamTogetherSelection(score: Score, selection: Selection, selectedScoreIndex?: number): boolean {
  const targets = beamSelectionsForWriteback(score, selection, selectedScoreIndex);
  if (!targets || !canBeamTogetherSelection(score, selection, selectedScoreIndex)) return false;

  let changed = false;
  for (const target of targets) {
    const measure = score.parts[target.partIndex]?.measures[target.measureIndex];
    const eventIds = beamSelectionIds(score, target, true);
    if (!measure || !eventIds) continue;
    const selectedIds = new Set(eventIds);
    const retained = (measure.beams ?? []).flatMap((beam) => removeEventsFromBeamGroup(beam, selectedIds));
    retained.push({ events: eventIds });
    measure.beams = retained;
    changed = true;
  }
  return changed;
}
