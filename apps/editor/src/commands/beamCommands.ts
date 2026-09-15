import { walkSequenceEvents, type Beam, type BeamHookDirection, type NoteEvent, type Score } from "@viritura/core";
import type { EventLocation } from "../score/ElementPath";
import type { Selection } from "../store/selectionStore";
import { resolveSelectionEvents } from "../store/selectionUtils";
import { planSelectionWriteback, resolveCondensedEventTargets } from "../score/condensedWriteback";
import { beamFlagCount, ensureBeamEventId, resolveAutomaticBeamGroups } from "./autoBeaming";
import { getEffectiveTimeSignature } from "./noteCommands";

function cloneScore(score: Score): Score {
  return JSON.parse(JSON.stringify(score)) as Score;
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

function beamableEventSelection(
  score: Score,
  locations: readonly EventLocation[],
  minimumFlagCount = 1,
): BeamSelection | null {
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
    if (!event?.notes?.length || beamFlagCount(event) < minimumFlagCount) return null;
    previousEventIndex = loc.eventIndex;
  }

  return {
    partIndex: first.partIndex,
    measureIndex: first.measureIndex,
    sequenceIndex: first.sequenceIndex,
    locations: orderedLocations,
  };
}

function beamSelectionIds(score: Score, selection: BeamSelection, createMissingIds: boolean): string[] | null {
  const ids: string[] = [];
  for (const loc of selection.locations) {
    const event = eventAtLocation(score, loc);
    if (!event) return null;
    const eventId = createMissingIds ? ensureBeamEventId(event) : event.id;
    if (!eventId) return null;
    ids.push(eventId);
  }
  return ids;
}

function beamSelectionsForWriteback(
  score: Score,
  selection: Selection,
  selectedScoreIndex?: number,
  minimumFlagCount = 1,
): BeamSelection[] | null {
  const visualSelection =
    selection.kind === "range" || selection.kind === "multi"
      ? beamableEventSelection(score, resolveSelectionEvents(selection, score), minimumFlagCount)
      : null;
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
  const sourceSelections = [...locationsByVoice.values()].map((locations) =>
    beamableEventSelection(score, locations, minimumFlagCount),
  );
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
    const owner = eventIds?.[0] ? findExplicitBeamOwner(score, sourceSelection.partIndex, eventIds[0]) : null;
    return (
      measure !== undefined &&
      (eventIds === null ||
        !owner?.beams.some(
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
  if (!target || beamFlagCount(target.event) === 0) return false;
  const targetId = target.event.id;
  if (!targetId) return true;

  const explicitOwner = findExplicitBeamOwner(score, target.loc.partIndex, targetId);
  if (explicitOwner) return splitBeamGroup(explicitOwner.beams, targetId) !== null;

  if (score.mnx.support?.useBeams === true) return false;
  const materialized = automaticBeamsForMeasure(score, target.loc.partIndex, target.loc.measureIndex, false);
  return splitBeamGroup(materialized, targetId) !== null;
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

function automaticBeamsForMeasure(
  score: Score,
  partIndex: number,
  measureIndex: number,
  createMissingIds: boolean,
): Beam[] {
  const measure = score.parts[partIndex]?.measures[measureIndex];
  if (!measure) return [];
  const sequences = createMissingIds ? measure.sequences : structuredClone(measure.sequences);
  const time = getEffectiveTimeSignature(score, measureIndex);
  const excludedIds = explicitBeamIds(score, partIndex);
  return sequences.flatMap((sequence) => resolveAutomaticBeamGroups(sequence.content, time, excludedIds));
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

function eventsById(score: Score, partIndex: number): Map<string, NoteEvent> {
  const result = new Map<string, NoteEvent>();
  for (const measure of score.parts[partIndex]?.measures ?? []) {
    for (const sequence of measure.sequences ?? []) {
      for (const { event } of walkSequenceEvents(sequence.content)) {
        if (event.id) result.set(event.id, event);
      }
    }
  }
  return result;
}

function sortBeamsByParentOrder(beams: Beam[], parent: Beam): void {
  const order = new Map(parent.events.map((id, index) => [id, index]));
  beams.sort((a, b) => (order.get(a.events[0] ?? "") ?? Number.MAX_SAFE_INTEGER) - (order.get(b.events[0] ?? "") ?? 0));
}

function inferredChildren(parent: Beam, level: number, eventMap: ReadonlyMap<string, NoteEvent>): Beam[] {
  const children: Beam[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length > 0) {
      children.push(run.length === 1 ? { events: run, direction: "auto" } : { events: run });
    }
    run = [];
  };
  for (const id of parent.events) {
    const event = eventMap.get(id);
    if (event?.notes?.length && beamFlagCount(event) >= level) run.push(id);
    else flush();
  }
  flush();
  return children;
}

function materializeChildren(parent: Beam, level: number, eventMap: ReadonlyMap<string, NoteEvent>): Beam[] {
  if (!parent.beams || parent.beams.length === 0) {
    parent.beams = inferredChildren(parent, level, eventMap);
  }
  return parent.beams;
}

function ensurePrimaryOwner(
  score: Score,
  partIndex: number,
  measureIndex: number,
  eventIds: readonly string[],
): Beam | null {
  const existing = eventIds
    .map((id) => findExplicitBeamOwner(score, partIndex, id))
    .filter((owner): owner is NonNullable<typeof owner> => owner !== null);
  if (existing.length > 0) {
    const firstOwner = existing[0]!;
    if (existing.some((owner) => owner.measureIndex !== firstOwner.measureIndex || owner.beams !== firstOwner.beams)) {
      return null;
    }
    return firstOwner.beams.find((beam) => eventIds.every((id) => beam.events.includes(id))) ?? null;
  }
  if (score.mnx.support?.useBeams === true) return null;
  const measure = score.parts[partIndex]?.measures[measureIndex];
  if (!measure) return null;
  const automatic = automaticBeamsForMeasure(score, partIndex, measureIndex, true);
  if (automatic.length === 0) return null;
  measure.beams = [...(measure.beams ?? []), ...automatic];
  return automatic.find((beam) => eventIds.every((id) => beam.events.includes(id))) ?? null;
}

function containingParentAtLevel(
  root: Beam,
  level: number,
  eventIds: readonly string[],
  eventMap: ReadonlyMap<string, NoteEvent>,
): Beam | null {
  let parent = root;
  for (let childLevel = 2; childLevel < level; childLevel++) {
    const children = materializeChildren(parent, childLevel, eventMap);
    const child = children.find((candidate) => eventIds.every((id) => candidate.events.includes(id)));
    if (!child) return null;
    parent = child;
  }
  return parent;
}

function retainedInnerGroups(beam: Beam, removedIds: ReadonlySet<string>): Beam[] {
  const groups: Beam[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (run.length > 0) {
      const retained = filterNestedBeam(beam, new Set(run));
      if (retained) {
        if (retained.events.length === 1 && retained.direction === undefined) retained.direction = "auto";
        groups.push(retained);
      }
    }
    run = [];
  };
  for (const id of beam.events) {
    if (removedIds.has(id)) flush();
    else run.push(id);
  }
  flush();
  return groups;
}

function joinInnerBeam(score: Score, selection: BeamSelection, level: number): boolean {
  const ids = beamSelectionIds(score, selection, true);
  if (!ids) return false;
  const root = ensurePrimaryOwner(score, selection.partIndex, selection.measureIndex, ids);
  if (!root) return false;
  const eventMap = eventsById(score, selection.partIndex);
  const parent = containingParentAtLevel(root, level, ids, eventMap);
  if (!parent) return false;
  const children = materializeChildren(parent, level, eventMap);
  if (
    children.some(
      (child) =>
        child.direction === undefined &&
        child.events.length === ids.length &&
        child.events.every((id, index) => id === ids[index]),
    )
  ) {
    return false;
  }

  const selectedIds = new Set(ids);
  const nested: Beam[] = [];
  const retained = children.flatMap((child) => {
    const selectedPart = filterNestedBeam(child, selectedIds);
    if (selectedPart?.beams) nested.push(...selectedPart.beams);
    return retainedInnerGroups(child, selectedIds);
  });
  retained.push({ events: ids, ...(nested.length > 0 ? { beams: nested } : {}) });
  sortBeamsByParentOrder(retained, parent);
  parent.beams = retained;
  return true;
}

function splitInnerBeam(score: Score, target: { loc: EventLocation; event: NoteEvent }, level: number): boolean {
  if (!target.event.notes?.length || beamFlagCount(target.event) < level) return false;
  const targetId = target.event.id ?? ensureBeamEventId(target.event);
  const root = ensurePrimaryOwner(score, target.loc.partIndex, target.loc.measureIndex, [targetId]);
  if (!root) return false;
  const eventMap = eventsById(score, target.loc.partIndex);
  const parent = containingParentAtLevel(root, level, [targetId], eventMap);
  if (!parent) return false;
  const children = materializeChildren(parent, level, eventMap);
  const groupIndex = children.findIndex((child) => child.events.includes(targetId));
  if (groupIndex < 0) return false;
  const group = children[groupIndex]!;
  const eventIndex = group.events.indexOf(targetId);
  if (eventIndex === group.events.length - 1) return false;

  const segments = [group.events.slice(0, eventIndex + 1), group.events.slice(eventIndex + 1)].map((events) => {
    const retained = filterNestedBeam(group, new Set(events)) ?? { events };
    if (retained.events.length === 1 && retained.direction === undefined) retained.direction = "auto";
    return retained;
  });
  parent.beams = [...children.slice(0, groupIndex), ...segments, ...children.slice(groupIndex + 1)];
  return true;
}

function selectedLocationsForWriteback(
  score: Score,
  selection: Selection,
  selectedScoreIndex?: number,
): EventLocation[] {
  const target = selectedTarget(score, selection);
  if (!target) return [];
  return selectedScoreIndex === undefined
    ? [target.loc]
    : resolveCondensedEventTargets(score, selectedScoreIndex, target.loc);
}

function setInnerBeamlet(
  score: Score,
  target: { loc: EventLocation; event: NoteEvent },
  level: number,
  direction: BeamHookDirection | null,
): boolean {
  if (!target.event.notes?.length || beamFlagCount(target.event) < level) return false;
  const id = target.event.id ?? ensureBeamEventId(target.event);
  const root = ensurePrimaryOwner(score, target.loc.partIndex, target.loc.measureIndex, [id]);
  if (!root) return false;
  const eventMap = eventsById(score, target.loc.partIndex);
  const parent = containingParentAtLevel(root, level, [id], eventMap);
  if (!parent) return false;
  const children = materializeChildren(parent, level, eventMap);
  const current = children.find((child) => child.events.includes(id));
  if (!current) return false;

  if (direction !== null) {
    if (current.events.length === 1 && current.direction === direction) return false;
    const selected = filterNestedBeam(current, new Set([id]));
    const retained = children.flatMap((child) => retainedInnerGroups(child, new Set([id])));
    retained.push({
      events: [id],
      direction,
      ...(selected?.beams && selected.beams.length > 0 ? { beams: selected.beams } : {}),
    });
    sortBeamsByParentOrder(retained, parent);
    parent.beams = retained;
    return true;
  }

  if (current.events.length > 1 && current.direction === undefined) return false;
  const index = parent.events.indexOf(id);
  if (index < 0) return false;
  let start = index;
  let end = index;
  const isEligible = (eventId: string): boolean => {
    const event = eventMap.get(eventId);
    return event !== undefined && beamFlagCount(event) >= level;
  };
  while (start > 0 && isEligible(parent.events[start - 1]!)) start--;
  while (end + 1 < parent.events.length && isEligible(parent.events[end + 1]!)) end++;
  const restoredIds = parent.events.slice(start, end + 1);
  if (restoredIds.length < 2) return false;
  const restoredSet = new Set(restoredIds);
  const nested: Beam[] = [];
  const retained = children.flatMap((child) => {
    const restoredPart = filterNestedBeam(child, restoredSet);
    if (restoredPart?.beams) nested.push(...restoredPart.beams);
    return retainedInnerGroups(child, restoredSet);
  });
  retained.push({ events: restoredIds, ...(nested.length > 0 ? { beams: nested } : {}) });
  sortBeamsByParentOrder(retained, parent);
  parent.beams = retained;
  return true;
}

/**
 * Break the beam after the last note covered by the selection.
 *
 * Returns true when a connected beam group was split. The score is mutated so
 * callers can apply the command inside their existing Immer transaction.
 */
function breakBeamAfterLocation(score: Score, target: { loc: EventLocation; event: NoteEvent }): boolean {
  if (!target || beamFlagCount(target.event) === 0) return false;

  const measure = score.parts[target.loc.partIndex]?.measures[target.loc.measureIndex];
  if (!measure) return false;

  const targetId = ensureBeamEventId(target.event);
  const explicitOwner = findExplicitBeamOwner(score, target.loc.partIndex, targetId);
  if (explicitOwner) {
    const split = splitBeamGroup(explicitOwner.beams, targetId);
    if (!split) return false;
    score.parts[target.loc.partIndex]!.measures[explicitOwner.measureIndex]!.beams = split;
    return true;
  }

  if (score.mnx.support?.useBeams === true) return false;
  const materialized = automaticBeamsForMeasure(score, target.loc.partIndex, target.loc.measureIndex, true);
  const split = splitBeamGroup(materialized, targetId);
  if (!split) return false;
  measure.beams = [...(measure.beams ?? []), ...split];
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
    const selectedChildren: Beam[] = [];
    for (const partMeasure of score.parts[target.partIndex]?.measures ?? []) {
      if (!partMeasure.beams?.some((beam) => beam.events.some((id) => selectedIds.has(id)))) continue;
      const retained = partMeasure.beams.flatMap((beam) => {
        const selected = filterNestedBeam(beam, selectedIds);
        if (selected?.beams) selectedChildren.push(...selected.beams);
        return removeEventsFromBeamGroup(beam, selectedIds);
      });
      partMeasure.beams = retained;
    }
    const joined: Beam = {
      events: eventIds,
      ...(selectedChildren.length > 0 ? { beams: selectedChildren } : {}),
    };
    if (joined.beams) sortBeamsByParentOrder(joined.beams, joined);
    measure.beams = [...(measure.beams ?? []), joined];
    changed = true;
  }
  return changed;
}

export type BeamletState = "full" | BeamHookDirection;

export interface BeamSelectionInfo {
  readonly isAvailable: boolean;
  readonly maxLevel: number;
  readonly selectedEventCount: number;
  readonly beamletState: BeamletState | null;
}

function beamletStateAtLevel(
  score: Score,
  target: { loc: EventLocation; event: NoteEvent },
  level: number,
): BeamletState | null {
  if (level < 2 || beamFlagCount(target.event) < level) return null;
  const clone = cloneScore(score);
  const event = eventAtLocation(clone, target.loc);
  if (!event) return null;
  const id = event.id ?? ensureBeamEventId(event);
  const root = ensurePrimaryOwner(clone, target.loc.partIndex, target.loc.measureIndex, [id]);
  if (!root) return null;
  const parent = containingParentAtLevel(root, level, [id], eventsById(clone, target.loc.partIndex));
  if (!parent) return null;
  const child = materializeChildren(parent, level, eventsById(clone, target.loc.partIndex)).find((beam) =>
    beam.events.includes(id),
  );
  if (!child) return null;
  return child.events.length === 1 ? (child.direction ?? "auto") : "full";
}

export function getBeamSelectionInfo(score: Score | null, selection: Selection, level: number): BeamSelectionInfo {
  if (!score) return { isAvailable: false, maxLevel: 0, selectedEventCount: 0, beamletState: null };
  const locations = resolveSelectionEvents(selection, score);
  const events = locations.map((location) => ({ location, event: eventAtLocation(score, location) }));
  if (events.length === 0 || events.some(({ event }) => !event?.notes?.length || beamFlagCount(event) === 0)) {
    return { isAvailable: false, maxLevel: 0, selectedEventCount: events.length, beamletState: null };
  }
  const maxLevel = Math.min(...events.map(({ event }) => beamFlagCount(event!)));
  const singleEvent = events.length === 1 ? events[0] : undefined;
  return {
    isAvailable: true,
    maxLevel,
    selectedEventCount: events.length,
    beamletState:
      singleEvent?.event && level >= 2
        ? beamletStateAtLevel(score, { loc: singleEvent.location, event: singleEvent.event }, level)
        : null,
  };
}

export function canJoinBeamAtLevel(
  score: Score | null,
  selection: Selection,
  level: number,
  selectedScoreIndex?: number,
): boolean {
  if (!score || level < 1) return false;
  if (level === 1) return canBeamTogetherSelection(score, selection, selectedScoreIndex);
  const clone = cloneScore(score);
  return joinBeamAtLevel(clone, selection, level, selectedScoreIndex);
}

export function joinBeamAtLevel(
  score: Score,
  selection: Selection,
  level: number,
  selectedScoreIndex?: number,
): boolean {
  if (level < 1) return false;
  if (level === 1) return beamTogetherSelection(score, selection, selectedScoreIndex);
  const targets = beamSelectionsForWriteback(score, selection, selectedScoreIndex, level);
  if (!targets) return false;
  const probe = cloneScore(score);
  const probeTargets = beamSelectionsForWriteback(probe, selection, selectedScoreIndex, level);
  if (!probeTargets || !probeTargets.every((target) => joinInnerBeam(probe, target, level))) return false;
  return targets.every((target) => joinInnerBeam(score, target, level));
}

export function canBreakBeamAfterAtLevel(
  score: Score | null,
  selection: Selection,
  level: number,
  selectedScoreIndex?: number,
): boolean {
  if (!score || level < 1) return false;
  if (level === 1 && selectedScoreIndex === undefined) return canBreakBeamAfterSelection(score, selection);
  const clone = cloneScore(score);
  return breakBeamAfterAtLevel(clone, selection, level, selectedScoreIndex);
}

export function breakBeamAfterAtLevel(
  score: Score,
  selection: Selection,
  level: number,
  selectedScoreIndex?: number,
): boolean {
  if (level < 1) return false;
  if (level === 1) return breakBeamAfterSelection(score, selection, selectedScoreIndex);
  const locations = selectedLocationsForWriteback(score, selection, selectedScoreIndex);
  if (locations.length === 0) return false;
  const probe = cloneScore(score);
  if (
    !locations.every((location) => {
      const event = eventAtLocation(probe, location);
      return event ? splitInnerBeam(probe, { loc: location, event }, level) : false;
    })
  ) {
    return false;
  }
  return locations.every((location) => {
    const event = eventAtLocation(score, location);
    return event ? splitInnerBeam(score, { loc: location, event }, level) : false;
  });
}

export function canSetBeamletDirection(
  score: Score | null,
  selection: Selection,
  level: number,
  direction: BeamHookDirection | null,
  selectedScoreIndex?: number,
): boolean {
  if (!score || level < 2 || resolveSelectionEvents(selection, score).length !== 1) return false;
  const clone = cloneScore(score);
  return setBeamletDirection(clone, selection, level, direction, selectedScoreIndex);
}

export function setBeamletDirection(
  score: Score,
  selection: Selection,
  level: number,
  direction: BeamHookDirection | null,
  selectedScoreIndex?: number,
): boolean {
  if (level < 2 || resolveSelectionEvents(selection, score).length !== 1) return false;
  const locations = selectedLocationsForWriteback(score, selection, selectedScoreIndex);
  if (locations.length === 0) return false;
  const probe = cloneScore(score);
  if (
    !locations.every((location) => {
      const event = eventAtLocation(probe, location);
      return event ? setInnerBeamlet(probe, { loc: location, event }, level, direction) : false;
    })
  ) {
    return false;
  }
  return locations.every((location) => {
    const event = eventAtLocation(score, location);
    return event ? setInnerBeamlet(score, { loc: location, event }, level, direction) : false;
  });
}
