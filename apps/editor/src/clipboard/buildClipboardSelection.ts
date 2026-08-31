// Pure extraction of clipboard-selection building from App.tsx.
// Builds a ClipboardSelection / ClipboardSourceRef from a Score + Selection,
// with no React or store dependencies. Consumed by useClipboardActions in App.tsx.
import type { Score, TimeSignature, KeySignature, SequenceContent } from "@viritura/core";
import { measureBeats } from "@viritura/core";
import type { ClipboardSelection } from "../commands/clipboardCommands";
import type { ClipboardTrack, CapturedDynamic } from "./ClipboardFragment";
import type { ClipboardSourceRef } from "../store/clipboardHistoryStore";
import type { SelectionState } from "../store/selectionStore";
import {
  resolveEventLocation,
  resolveEventFromSubElement,
  getEventAtLocation,
  resolveAnnotationLocation,
  type AnnotationLocation,
  type EventLocation,
} from "../score/ElementPath";
import { resolveSelectionMeasureRange, resolveRangeElementIds } from "../store/selectionUtils";
import { resolveCondensedSelectionEvents } from "../score/condensedWriteback";
import { expandCondensedDynamicLocations } from "../commands/deleteCommands";
import { sequenceContentBeats, decomposeDuration, generateEventId } from "../commands/noteCommands";
import { buildNavigationIndex } from "../navigation/NavigationIndex";

/** Walk backwards from measureIndex to find the most recent clef on partIndex. */
function getActiveClef(score: Score, partIndex: number, measureIndex: number) {
  for (let m = measureIndex; m >= 0; m--) {
    const clefs = score.parts[partIndex]?.measures[m]?.clefs;
    if (clefs && clefs.length > 0) return clefs[0]!.clef;
  }
  return undefined;
}

/**
 * Collect dynamics from `partIdx`'s measures [startMeasure, endMeasure] whose
 * position (in quarter-note beats) falls within the captured range. The first
 * measure's window starts at `firstMeasureStartBeat`; the last measure's window
 * ends at `lastMeasureEndBeat`. Intermediate measures are fully included.
 *
 * Returns each dynamic with its `measureOffset` relative to `startMeasure`.
 */
function collectDynamics(
  score: Score,
  partIdx: number,
  startMeasure: number,
  endMeasure: number,
  firstMeasureStartBeat: number,
  lastMeasureEndBeat: number,
): CapturedDynamic[] {
  const result: CapturedDynamic[] = [];
  const part = score.parts[partIdx];
  if (!part) return result;
  const measureIndexById = new Map(
    score.global.measures.flatMap((measure, index) => (measure.id ? [[measure.id, index] as const] : [])),
  );
  for (let m = startMeasure; m <= Math.min(endMeasure, part.measures.length - 1); m++) {
    const measure = part.measures[m];
    const dyns = measure?.dynamics;
    if (!dyns || dyns.length === 0) continue;
    const isFirst = m === startMeasure;
    const isLast = m === endMeasure;
    for (const d of dyns) {
      const frac = d.position?.fraction;
      if (!frac || frac[1] === 0) continue;
      const beats = (frac[0] / frac[1]) * 4;
      if (isFirst && beats < firstMeasureStartBeat - 1e-9) continue;
      if (isLast && beats > lastMeasureEndBeat + 1e-9) continue;
      const cloned = structuredClone(d);
      // For the first measure of the selection, store positions relative
      // to the selection window so paste can simply add pasteStartBeat.
      if (isFirst && firstMeasureStartBeat > 0) {
        const rel = beats - firstMeasureStartBeat;
        const denom = 16;
        const num = Math.round((rel / 4) * denom);
        cloned.position = { fraction: [num, denom] };
      }
      let endMeasureOffset: number | undefined;
      if (cloned.type === "gradual") {
        const endMeasureIndex = measureIndexById.get(cloned.end.measure);
        if (endMeasureIndex === undefined) continue;
        endMeasureOffset = endMeasureIndex - startMeasure;
        if (endMeasureIndex === startMeasure && firstMeasureStartBeat > 0) {
          const endBeats = (cloned.end.position.fraction[0] / cloned.end.position.fraction[1]) * 4;
          const relativeEnd = endBeats - firstMeasureStartBeat;
          cloned.end.position = { fraction: [Math.round((relativeEnd / 4) * 16), 16] };
        }
      }
      result.push({ measureOffset: m - startMeasure, endMeasureOffset, dynamic: cloned });
    }
  }
  return result;
}

/**
 * Build a ClipboardSelection from the current Score + Selection.
 *
 * Returns null when the selection cannot be resolved to copyable events
 * (e.g. empty selection, unresolvable element id, no events in measure-mode
 * range). Pure function with no React or store dependencies.
 */
export function buildClipboardSelection(
  score: Score | null,
  selection: SelectionState,
  selectedScoreIndex?: number,
): ClipboardSelection | null {
  if (!score) return null;
  if (selection.kind === "single") return buildSingleClipboardSelection(score, selection, selectedScoreIndex);
  if (selection.kind === "range") return buildRangeClipboardSelection(score, selection, selectedScoreIndex);
  if (selection.kind === "multi") return buildMultiClipboardSelection(score, selection, selectedScoreIndex);
  if (selection.kind === "measure") return buildMeasureClipboardSelection(score, selection);
  return null;
}

function resolveActiveTimeKey(score: Score, measureIndex: number): { time: TimeSignature; key: KeySignature } {
  let activeTime: TimeSignature = { count: 4, unit: 4 };
  let activeKey: KeySignature = { fifths: 0 };
  for (let m = measureIndex; m >= 0; m--) {
    const gm = score.global.measures[m];
    if (gm?.time && !activeTime) activeTime = gm.time;
    if (gm?.key && !activeKey) activeKey = gm.key;
  }
  return { time: activeTime, key: activeKey };
}

function buildSingleClipboardSelection(
  score: Score,
  selection: Extract<SelectionState, { kind: "single" }>,
  selectedScoreIndex?: number,
): ClipboardSelection | null {
  const loc = resolveEventLocation(selection.elementId, score);
  if (!loc) return null;
  const event = getEventAtLocation(score, loc);
  if (!event) return null;
  const routed =
    selectedScoreIndex === undefined ? [loc] : resolveCondensedSelectionEvents(score, selection, selectedScoreIndex);
  const tracks =
    new Set(routed.map((location) => location.partIndex)).size > 1
      ? routed.flatMap((location) => {
          const sourceEvent = getEventAtLocation(score, location);
          return sourceEvent
            ? [
                {
                  partOffset: location.partIndex - loc.partIndex,
                  voiceIndex: location.sequenceIndex,
                  content: [sourceEvent],
                },
              ]
            : [];
        })
      : undefined;
  const { time, key } = resolveActiveTimeKey(score, loc.measureIndex);
  return {
    events: [event],
    timeSignature: time,
    keySignature: key,
    clef: getActiveClef(score, loc.partIndex, loc.measureIndex),
    transposition: score.parts[loc.partIndex]?.transposition,
    partIndex: loc.partIndex,
    measureIndex: loc.measureIndex,
    sequenceIndex: loc.sequenceIndex,
    eventIndex: loc.eventIndex,
    tracks,
    cutLocations: routed,
  };
}

function buildMultiClipboardSelection(
  score: Score,
  selection: Extract<SelectionState, { kind: "multi" }>,
  selectedScoreIndex?: number,
): ClipboardSelection | null {
  const events: SequenceContent[] = [];
  let firstLoc: { partIndex: number; measureIndex: number; sequenceIndex: number; eventIndex: number } | null = null;
  const locations =
    selectedScoreIndex === undefined
      ? selection.elementIds.flatMap((elementId) => {
          const location = resolveEventFromSubElement(elementId, score) ?? resolveEventLocation(elementId, score);
          return location ? [location] : [];
        })
      : resolveCondensedSelectionEvents(score, selection, selectedScoreIndex);
  const annotationLocations = selection.elementIds
    .map(resolveAnnotationLocation)
    .filter((location): location is AnnotationLocation => location !== null);
  const cutAnnotationLocations =
    selectedScoreIndex === undefined
      ? annotationLocations
      : expandCondensedDynamicLocations(score, annotationLocations, selectedScoreIndex);
  for (const loc of locations) {
    const event = getEventAtLocation(score, loc);
    if (!event) continue;
    if (!firstLoc) firstLoc = loc;
    events.push(event);
  }
  if (events.length === 0 || !firstLoc) return null;
  const trackMap = new Map<string, ClipboardTrack>();
  for (const location of locations) {
    const sourceEvent = getEventAtLocation(score, location);
    if (!sourceEvent) continue;
    const key = `${location.partIndex}/${location.sequenceIndex}`;
    const track = trackMap.get(key) ?? {
      partOffset: location.partIndex - firstLoc.partIndex,
      voiceIndex: location.sequenceIndex,
      content: [],
    };
    track.content.push(sourceEvent);
    trackMap.set(key, track);
  }
  const tracks = new Set(locations.map((location) => location.partIndex)).size > 1 ? [...trackMap.values()] : undefined;
  const capturedDynamics = captureSelectedDynamics(score, cutAnnotationLocations, firstLoc);
  if (tracks) {
    for (const track of tracks) {
      const partIndex = firstLoc.partIndex + track.partOffset;
      const dynamics = capturedDynamics.filter((dynamic) => dynamic.partIndex === partIndex);
      if (dynamics.length > 0) track.dynamics = dynamics.map(({ partIndex: _partIndex, ...captured }) => captured);
    }
  }
  const { time, key } = resolveActiveTimeKey(score, firstLoc.measureIndex);
  return {
    events,
    timeSignature: time,
    keySignature: key,
    partIndex: firstLoc.partIndex,
    measureIndex: firstLoc.measureIndex,
    sequenceIndex: firstLoc.sequenceIndex,
    eventIndex: firstLoc.eventIndex,
    tracks,
    dynamics: capturedDynamics
      .filter((dynamic) => dynamic.partIndex === firstLoc.partIndex)
      .map(({ partIndex: _partIndex, ...captured }) => captured),
    cutLocations: locations,
    cutAnnotationLocations,
  };
}

function eventStartBeat(score: Score, location: EventLocation): number {
  const sequence = score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex];
  if (!sequence) return 0;
  return sequence.content
    .slice(0, location.tupletIndex ?? location.eventIndex)
    .reduce((sum, item) => sum + sequenceContentBeats(item), 0);
}

function dynamicIndexAtLocation(score: Score, location: AnnotationLocation): number {
  if (location.partIndex === undefined) return -1;
  const dynamics = score.parts[location.partIndex]?.measures[location.measureIndex]?.dynamics ?? [];
  if (location.annotationId) return dynamics.findIndex((dynamic) => dynamic.id === location.annotationId);
  if (location.annotationIndex === undefined) return -1;
  if (location.type !== "hairpin") return location.annotationIndex;
  return (
    dynamics.map((dynamic, index) => ({ dynamic, index })).filter(({ dynamic }) => dynamic.type === "gradual")[
      location.annotationIndex
    ]?.index ?? -1
  );
}

function captureSelectedDynamics(
  score: Score,
  locations: readonly AnnotationLocation[],
  firstEvent: EventLocation,
): (CapturedDynamic & { partIndex: number })[] {
  const firstBeat = eventStartBeat(score, firstEvent);
  const measureById = new Map(
    score.global.measures.flatMap((measure, index) => (measure.id ? [[measure.id, index] as const] : [])),
  );
  return locations.flatMap((location) => {
    if (location.partIndex === undefined || (location.type !== "dyn" && location.type !== "hairpin")) return [];
    const dynamic =
      score.parts[location.partIndex]?.measures[location.measureIndex]?.dynamics?.[
        dynamicIndexAtLocation(score, location)
      ];
    if (!dynamic) return [];
    const cloned = structuredClone(dynamic);
    if (location.measureIndex === firstEvent.measureIndex) {
      const [numerator, denominator] = cloned.position.fraction;
      const relative = (denominator === 0 ? 0 : (numerator / denominator) * 4) - firstBeat;
      cloned.position = { fraction: [Math.round(relative * 4), 16] };
    }
    const endMeasureOffset =
      cloned.type === "gradual"
        ? (measureById.get(cloned.end.measure) ?? location.measureIndex) - firstEvent.measureIndex
        : undefined;
    return [
      {
        partIndex: location.partIndex,
        measureOffset: location.measureIndex - firstEvent.measureIndex,
        endMeasureOffset,
        dynamic: cloned,
      },
    ];
  });
}

interface RangeResolved {
  range: NonNullable<ReturnType<typeof resolveSelectionMeasureRange>>;
  selectedIds: Set<string>;
}

function eventIdAtLocation(score: Score, location: EventLocation): string | undefined {
  const event = getEventAtLocation(score, location);
  if (event?.type !== "event") return undefined;
  return `p${location.partIndex}/m${location.measureIndex}/s${location.sequenceIndex}/${event.id ?? `e${location.eventIndex}`}`;
}

function resolveRangeAndIds(
  score: Score,
  selection: Extract<SelectionState, { kind: "range" }>,
  selectedScoreIndex?: number,
): RangeResolved | null {
  const selectedIds = new Set(resolveRangeElementIds(selection.startElementId, selection.endElementId, score));
  const range =
    resolveSelectionMeasureRange(selection.startElementId, selection.endElementId, score) ??
    (() => {
      const entries = buildNavigationIndex(score).entries.filter((entry) => selectedIds.has(entry.elementId));
      if (entries.length === 0) return null;
      return {
        startMeasure: Math.min(...entries.map((entry) => entry.measureIndex)),
        endMeasure: Math.max(...entries.map((entry) => entry.measureIndex)),
        startPart: Math.min(...entries.map((entry) => entry.partIndex)),
        endPart: Math.max(...entries.map((entry) => entry.partIndex)),
        startVoice: Math.max(0, Math.min(...entries.map((entry) => entry.sequenceIndex))),
        endVoice: Math.max(0, Math.max(...entries.map((entry) => entry.sequenceIndex))),
      };
    })();
  if (!range) return null;
  if (selectedScoreIndex !== undefined) {
    for (const location of resolveCondensedSelectionEvents(score, selection, selectedScoreIndex)) {
      const id = eventIdAtLocation(score, location);
      if (id) selectedIds.add(id);
    }
  }
  if (selectedIds.size === 0) return null;
  return { range, selectedIds };
}

interface TrackedEvent {
  event: SequenceContent;
  partOffset: number;
  voiceIndex: number;
  absBeat: number;
  measureIndex: number;
  sortKey: number;
  eventBeats: number;
  location?: EventLocation;
}

function collectTrackedEvents(
  score: Score,
  range: RangeResolved["range"],
  selectedIds: Set<string>,
): { events: TrackedEvent[]; selectionStartBeat: number } {
  const navIndex = buildNavigationIndex(score);
  const capturedContainers = new Set<string>();
  const getTimeSigAt = (mIdx: number): TimeSignature => {
    let ts: TimeSignature = { count: 4, unit: 4 };
    for (let i = 0; i <= mIdx && i < score.global.measures.length; i++) {
      const gm = score.global.measures[i];
      if (gm?.time) ts = gm.time;
    }
    return ts;
  };
  const absoluteBeat = (mIdx: number, sortKey: number): number => {
    let beats = 0;
    for (let m = range.startMeasure; m < mIdx; m++) beats += measureBeats(getTimeSigAt(m));
    return beats + sortKey;
  };
  const events: TrackedEvent[] = [];
  let selectionStartBeat = Infinity;
  for (const entry of navIndex.entries) {
    if (!selectedIds.has(entry.elementId)) continue;
    if (entry.elementType !== "event" && entry.elementType !== "rest") continue;
    const sequence = score.parts[entry.partIndex]?.measures[entry.measureIndex]?.sequences[entry.sequenceIndex];
    if (!sequence) continue;
    let event: SequenceContent | null | undefined;
    let sortKey = entry.sortKey;
    if (entry.tupletIndex !== undefined) {
      const containerKey = `${entry.partIndex}:${entry.measureIndex}:${entry.sequenceIndex}:${entry.tupletIndex}`;
      if (capturedContainers.has(containerKey)) continue;
      const container = sequence.content[entry.tupletIndex];
      if (container?.type !== "tuplet" && container?.type !== "tremolo") continue;
      capturedContainers.add(containerKey);
      event = container;
      // A tuplet/tremolo is an indivisible rhythmic unit on the clipboard. If
      // a range touches one of its inner events, capture the whole container at
      // its true onset so its ratio and real duration survive paste.
      sortKey = Math.min(
        ...navIndex.entries
          .filter(
            (candidate) =>
              candidate.partIndex === entry.partIndex &&
              candidate.measureIndex === entry.measureIndex &&
              candidate.sequenceIndex === entry.sequenceIndex &&
              candidate.tupletIndex === entry.tupletIndex,
          )
          .map((candidate) => candidate.sortKey),
      );
    } else {
      event = getEventAtLocation(score, {
        partIndex: entry.partIndex,
        measureIndex: entry.measureIndex,
        sequenceIndex: entry.sequenceIndex,
        eventIndex: entry.eventIndex,
      });
    }
    if (!event) continue;
    const absBeat = absoluteBeat(entry.measureIndex, sortKey);
    if (absBeat < selectionStartBeat) selectionStartBeat = absBeat;
    events.push({
      event,
      partOffset: entry.partIndex - range.startPart,
      voiceIndex: entry.sequenceIndex,
      absBeat,
      measureIndex: entry.measureIndex,
      sortKey,
      eventBeats: sequenceContentBeats(event),
      ...(entry.tupletIndex === undefined
        ? {
            location: {
              partIndex: entry.partIndex,
              measureIndex: entry.measureIndex,
              sequenceIndex: entry.sequenceIndex,
              eventIndex: entry.eventIndex,
            },
          }
        : {}),
    });
  }
  events.sort((left, right) => left.absBeat - right.absBeat);
  return { events, selectionStartBeat };
}

function groupByTrack(trackedEvents: TrackedEvent[]): Map<string, TrackedEvent[]> {
  const trackMap = new Map<string, TrackedEvent[]>();
  for (const te of trackedEvents) {
    const key = `${te.partOffset}:${te.voiceIndex}`;
    if (!trackMap.has(key)) trackMap.set(key, []);
    trackMap.get(key)!.push(te);
  }
  return trackMap;
}

interface TrackBeatWindow {
  firstMeasureForPart: number;
  lastMeasureForPart: number;
  firstBeatInFirstMeasure: number;
  lastBeatInLastMeasure: number;
}

function computeTrackBeatWindow(
  events: TrackedEvent[],
  range: RangeResolved["range"],
  first: TrackedEvent,
  last: TrackedEvent,
): TrackBeatWindow {
  let firstMeasureForPart = range.startMeasure;
  let lastMeasureForPart = range.endMeasure;
  let firstBeatInFirstMeasure = 0;
  let lastBeatInLastMeasure = Infinity;
  let minBeatHere = Infinity;
  let maxEndHere = -Infinity;
  for (const ev of events) {
    if (ev.measureIndex === firstMeasureForPart && ev.sortKey < minBeatHere) minBeatHere = ev.sortKey;
    if (ev.measureIndex === lastMeasureForPart) {
      const endBeat = ev.sortKey + ev.eventBeats;
      if (endBeat > maxEndHere) maxEndHere = endBeat;
    }
  }
  if (isFinite(minBeatHere)) firstBeatInFirstMeasure = minBeatHere;
  else firstMeasureForPart = first.measureIndex;
  if (isFinite(maxEndHere)) lastBeatInLastMeasure = maxEndHere;
  else lastMeasureForPart = last.measureIndex;
  return { firstMeasureForPart, lastMeasureForPart, firstBeatInFirstMeasure, lastBeatInLastMeasure };
}

function buildTrackFromEvents(
  score: Score,
  range: RangeResolved["range"],
  events: TrackedEvent[],
  isCrossPart: boolean,
  selectionStartBeat: number,
): ClipboardTrack {
  const first = events[0]!;
  const last = events[events.length - 1]!;
  const srcPartIndex = range.startPart + first.partOffset;
  const window = computeTrackBeatWindow(events, range, first, last);
  const dynamics = collectDynamics(
    score,
    srcPartIndex,
    window.firstMeasureForPart,
    window.lastMeasureForPart,
    window.firstBeatInFirstMeasure,
    window.lastBeatInLastMeasure,
  );
  const track: ClipboardTrack = {
    partOffset: first.partOffset,
    voiceIndex: first.voiceIndex,
    content: [],
    clef: getActiveClef(score, srcPartIndex, range.startMeasure),
    transposition: score.parts[srcPartIndex]?.transposition,
    ...(dynamics.length > 0 ? { dynamics } : {}),
  };
  if (isCrossPart) {
    const gap = first.absBeat - selectionStartBeat;
    if (gap > 1e-9) {
      for (const d of decomposeDuration(gap)) {
        track.content.push({ type: "event" as const, id: generateEventId(), duration: d, rest: {} });
      }
    }
  }
  for (const te of events) track.content.push(te.event);
  return track;
}

function padMissingPartTracks(score: Score, range: RangeResolved["range"], tracks: ClipboardTrack[]): void {
  if (tracks.length === 0) return;
  const primaryBeats = tracks[0]!.content.reduce((sum, ev) => sum + sequenceContentBeats(ev), 0);
  for (let p = range.startPart; p <= Math.min(range.endPart, score.parts.length - 1); p++) {
    const partOffset = p - range.startPart;
    if (!tracks.find((t) => t.partOffset === partOffset) && primaryBeats > 0) {
      const restEvents: SequenceContent[] = decomposeDuration(primaryBeats).map((d) => ({
        type: "event" as const,
        id: generateEventId(),
        duration: d,
        rest: {},
      }));
      tracks.push({ partOffset, voiceIndex: 0, content: restEvents });
    }
  }
  tracks.sort((a, b) => a.partOffset - b.partOffset || a.voiceIndex - b.voiceIndex);
}

function buildRangeClipboardSelection(
  score: Score,
  selection: Extract<SelectionState, { kind: "range" }>,
  selectedScoreIndex?: number,
): ClipboardSelection | null {
  const resolved = resolveRangeAndIds(score, selection, selectedScoreIndex);
  if (!resolved) return null;
  const { range, selectedIds } = resolved;
  const annotationLocations = [...selectedIds]
    .map(resolveAnnotationLocation)
    .filter((location): location is AnnotationLocation => location !== null);
  const cutAnnotationLocations =
    selectedScoreIndex === undefined
      ? annotationLocations
      : expandCondensedDynamicLocations(score, annotationLocations, selectedScoreIndex);
  const { events: trackedEvents, selectionStartBeat } = collectTrackedEvents(score, range, selectedIds);
  if (trackedEvents.length === 0) return null;
  const isCrossPart = new Set(trackedEvents.map((event) => event.partOffset)).size > 1;

  const trackMap = groupByTrack(trackedEvents);
  const tracks: ClipboardTrack[] = [];
  for (const [, events] of trackMap) {
    tracks.push(buildTrackFromEvents(score, range, events, isCrossPart, selectionStartBeat));
  }
  if (isCrossPart) padMissingPartTracks(score, range, tracks);
  const selectedDynamics = captureSelectedDynamics(
    score,
    cutAnnotationLocations,
    trackedEvents[0]!.location ?? {
      partIndex: range.startPart,
      measureIndex: range.startMeasure,
      sequenceIndex: range.startVoice,
      eventIndex: 0,
    },
  );
  for (const track of tracks) {
    const partIndex = range.startPart + track.partOffset;
    const dynamics = selectedDynamics.filter((dynamic) => dynamic.partIndex === partIndex);
    if (dynamics.length > 0) {
      track.dynamics = dynamics.map(({ partIndex: _partIndex, ...captured }) => captured);
    }
  }

  const primaryEvents: SequenceContent[] = tracks.length > 0 ? tracks[0]!.content : [];
  if (primaryEvents.length === 0) return null;

  const { time, key } = resolveActiveTimeKey(score, range.startMeasure);
  return {
    events: primaryEvents,
    timeSignature: time,
    keySignature: key,
    clef: getActiveClef(score, range.startPart, range.startMeasure),
    transposition: score.parts[range.startPart]?.transposition,
    tracks: isCrossPart && tracks.length > 1 ? tracks : undefined,
    dynamics: selectedDynamics
      .filter((dynamic) => dynamic.partIndex === range.startPart)
      .map(({ partIndex: _partIndex, ...captured }) => captured),
    partIndex: range.startPart,
    measureIndex: range.startMeasure,
    sequenceIndex: range.startVoice,
    eventIndex: 0,
    cutLocations: trackedEvents.every((event) => event.location !== undefined)
      ? trackedEvents.map((event) => event.location!)
      : undefined,
    cutAnnotationLocations,
  };
}

function collectMeasureContent(
  score: Score,
  partIndex: number,
  startMeasure: number,
  endMeasure: number,
): { content: SequenceContent[]; locations: EventLocation[]; exact: boolean } {
  const content: SequenceContent[] = [];
  const locations: EventLocation[] = [];
  let exact = true;
  const part = score.parts[partIndex];
  if (!part) return { content, locations, exact: false };
  for (
    let measureIndex = startMeasure;
    measureIndex <= Math.min(endMeasure, part.measures.length - 1);
    measureIndex++
  ) {
    const measure = part.measures[measureIndex];
    if (!measure) continue;
    for (let sequenceIndex = 0; sequenceIndex < measure.sequences.length; sequenceIndex++) {
      const sequence = measure.sequences[sequenceIndex]!;
      for (let eventIndex = 0; eventIndex < sequence.content.length; eventIndex++) {
        const item = sequence.content[eventIndex]!;
        content.push(item);
        if (item.type !== "event") {
          exact = false;
          continue;
        }
        locations.push({ partIndex, measureIndex, sequenceIndex, eventIndex });
      }
    }
  }
  return { content, locations, exact };
}

function collectMeasureTracks(
  score: Score,
  startPart: number,
  endPart: number,
  startMeasure: number,
  endMeasure: number,
): { tracks: ClipboardTrack[]; locations: EventLocation[]; exact: boolean } {
  const tracks: ClipboardTrack[] = [];
  const locations: EventLocation[] = [];
  let exact = true;
  for (let partIndex = startPart; partIndex <= Math.min(endPart, score.parts.length - 1); partIndex++) {
    const part = score.parts[partIndex];
    if (!part) continue;
    for (
      let measureIndex = startMeasure;
      measureIndex <= Math.min(endMeasure, part.measures.length - 1);
      measureIndex++
    ) {
      const measure = part.measures[measureIndex];
      if (!measure) continue;
      for (let sequenceIndex = 0; sequenceIndex < measure.sequences.length; sequenceIndex++) {
        const content = measure.sequences[sequenceIndex]!.content;
        if (content.length === 0) continue;
        const dynamics =
          sequenceIndex === 0 ? collectDynamics(score, partIndex, startMeasure, endMeasure, 0, Infinity) : undefined;
        tracks.push({
          partOffset: partIndex - startPart,
          voiceIndex: sequenceIndex,
          content: [...content],
          ...(dynamics && dynamics.length > 0 ? { dynamics } : {}),
        });
        for (let eventIndex = 0; eventIndex < content.length; eventIndex++) {
          if (content[eventIndex]?.type !== "event") {
            exact = false;
            continue;
          }
          locations.push({ partIndex, measureIndex, sequenceIndex, eventIndex });
        }
      }
    }
  }
  return { tracks, locations, exact };
}

function buildMeasureClipboardSelection(
  score: Score,
  selection: Extract<SelectionState, { kind: "measure" }>,
): ClipboardSelection | null {
  const startP = Math.min(selection.startPartIndex, selection.endPartIndex);
  const endP = Math.max(selection.startPartIndex, selection.endPartIndex);
  const startM = Math.min(selection.startMeasure, selection.endMeasure);
  const endM = Math.max(selection.startMeasure, selection.endMeasure);
  const isCrossPart = startP !== endP;

  // Collect events from the primary (first) part
  const primary = collectMeasureContent(score, startP, startM, endM);
  const primaryEvents = primary.content;
  if (primaryEvents.length === 0) return null;

  const crossPart = isCrossPart ? collectMeasureTracks(score, startP, endP, startM, endM) : undefined;
  const tracks = crossPart?.tracks;
  const cutLocations = crossPart?.locations ?? primary.locations;
  const exactCut = crossPart?.exact ?? primary.exact;

  const primaryDynamics = collectDynamics(score, startP, startM, endM, 0, Infinity);

  let activeTime: TimeSignature = { count: 4, unit: 4 };
  let activeKey: KeySignature = { fifths: 0 };
  for (let m = startM; m >= 0; m--) {
    const gm = score.global.measures[m];
    if (gm?.time && !activeTime) activeTime = gm.time;
    if (gm?.key && !activeKey) activeKey = gm.key;
  }

  return {
    events: primaryEvents,
    timeSignature: activeTime,
    keySignature: activeKey,
    tracks,
    dynamics: primaryDynamics.length > 0 ? primaryDynamics : undefined,
    partIndex: startP,
    measureIndex: startM,
    sequenceIndex: 0,
    eventIndex: 0,
    cutLocations: exactCut ? cutLocations : undefined,
  };
}

/**
 * Compute the snapshot reference (history snapshot id + part/measure range)
 * for the current selection at copy time. The preview uses this to render
 * the actual measures from the source score, preserving instrument names,
 * clefs, transpositions, and other engraving context that would otherwise
 * be lost when reducing to bare events.
 *
 * Returns undefined when no selection is resolvable; preview falls back to
 * the synthetic snippet rendering in that case.
 */
export function buildClipboardSourceRef(
  score: Score | null,
  selection: SelectionState,
  historyId: number | undefined,
): ClipboardSourceRef | undefined {
  if (!score) return undefined;
  if (historyId === undefined) return undefined;

  let partStart: number | undefined;
  let partEnd: number | undefined;
  let measureStart: number | undefined;
  let measureEnd: number | undefined;

  if (selection.kind === "single") {
    const loc = resolveEventLocation(selection.elementId, score);
    if (!loc) return undefined;
    partStart = partEnd = loc.partIndex;
    measureStart = measureEnd = loc.measureIndex;
  } else if (selection.kind === "range") {
    const range = resolveSelectionMeasureRange(selection.startElementId, selection.endElementId, score);
    if (!range) return undefined;
    partStart = Math.min(range.startPart, range.endPart);
    partEnd = Math.max(range.startPart, range.endPart);
    measureStart = Math.min(range.startMeasure, range.endMeasure);
    measureEnd = Math.max(range.startMeasure, range.endMeasure);
  } else if (selection.kind === "measure") {
    partStart = Math.min(selection.startPartIndex, selection.endPartIndex);
    partEnd = Math.max(selection.startPartIndex, selection.endPartIndex);
    measureStart = Math.min(selection.startMeasure, selection.endMeasure);
    measureEnd = Math.max(selection.startMeasure, selection.endMeasure);
  } else if (selection.kind === "multi") {
    // Walk all selected elements to compute the bounding part/measure box.
    for (const elementId of selection.elementIds) {
      const loc = resolveEventFromSubElement(elementId, score) ?? resolveEventLocation(elementId, score);
      if (!loc) continue;
      partStart = partStart === undefined ? loc.partIndex : Math.min(partStart, loc.partIndex);
      partEnd = partEnd === undefined ? loc.partIndex : Math.max(partEnd, loc.partIndex);
      measureStart = measureStart === undefined ? loc.measureIndex : Math.min(measureStart, loc.measureIndex);
      measureEnd = measureEnd === undefined ? loc.measureIndex : Math.max(measureEnd, loc.measureIndex);
    }
  }

  if (partStart === undefined || partEnd === undefined || measureStart === undefined || measureEnd === undefined) {
    return undefined;
  }

  const partIndices: number[] = [];
  for (let p = partStart; p <= partEnd; p++) partIndices.push(p);

  return { historyId, partIndices, startMeasure: measureStart, endMeasure: measureEnd };
}
