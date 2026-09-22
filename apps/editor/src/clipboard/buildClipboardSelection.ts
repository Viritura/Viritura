// Pure extraction of clipboard-selection building from App.tsx.
// Builds a ClipboardSelection / ClipboardSourceRef from a Score + Selection,
// with no React or store dependencies. Consumed by useClipboardActions in App.tsx.
import type { Score, SequenceContent, ChordSymbol, TimeSignature } from "@viritura/core";
import { measureBeats } from "@viritura/core";
import type { ClipboardSelection } from "../commands/clipboardCommands";
import type { CapturedChordSymbol, CapturedMeasureRepeat, ClipboardTrack } from "./ClipboardFragment";
import type { SelectionState } from "../store/selectionStore";
import {
  resolveEventLocation,
  resolveEventFromSubElement,
  getEventAtLocation,
  type AnnotationLocation,
  type EventLocation,
} from "../score/ElementPath";
import { resolveSelectionMeasureRange, resolveRangeElementIds } from "../store/selectionUtils";
import type { ChordRange } from "../store/chordRange";
import { resolveCondensedSelectionEvents } from "../score/condensedWriteback";
import { expandCondensedDynamicLocations } from "../commands/deleteCommands";
import { sequenceContentBeats, decomposeDuration, generateEventId } from "../commands/noteCommands";
import { buildNavigationIndex } from "../navigation/NavigationIndex";
import { measureRepeatElementIdsForSelection } from "../commands/measureRepeatCommands";
import { isLyricId } from "../commands/lyricCommands";
import { withClipboardLyricMetadata, withoutSelectedLyrics } from "./lyricMetadata";
import {
  captureChordSymbols,
  captureSelectedChordSymbols,
  chordSymbolStaffAtLocation,
  selectedChordStaffOffset,
  selectedChordSymbolOrigin,
  clipboardAnnotationLocation,
  resolveClipboardChordLocations,
  resolveChordClipboardRange,
  chordCutLocations,
  eventChordSources,
  captureEventChordSymbols,
  captureMeasureChordSymbols,
} from "./chordSymbolCapture";
import {
  assignDynamicsToTracks,
  captureSelectedDynamics,
  collectDynamics,
  dynamicStaffAtLocation,
  selectedDynamicOrigin,
} from "./dynamicCapture";
import {
  firstPhysicalTrack,
  partStaffOffset,
  selectionStaffAnchor,
  voiceIndexWithinStaff,
} from "./clipboardTrackMapping";
import {
  beatsBetweenMeasures,
  exactCaptureDifference,
  exactCaptureFraction,
  shiftSelectionOrigin,
  sourceStavesForPart,
  type CapturedSelection,
} from "./annotations";
import { captureTimedSelection } from "./captureTimedSelection";
import { buildChordAnnotationClipboardSelection } from "./chordAnnotationSelection";
import { getActiveClef, resolveActiveTimeKey } from "./sourceContext";
export { buildClipboardSourceRef } from "./sourceContext";

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
  if (selection.kind === "single" && isLyricId(selection.elementId)) return null;
  const chordAnnotationSelection = buildChordAnnotationClipboardSelection(score, selection, selectedScoreIndex);
  if (chordAnnotationSelection) return chordAnnotationSelection;
  const repeatSelection = buildMeasureRepeatClipboardSelection(score, selection);
  const regularSelection =
    selection.kind === "single"
      ? buildSingleClipboardSelection(score, selection, selectedScoreIndex)
      : selection.kind === "range"
        ? buildRangeClipboardSelection(score, selection, selectedScoreIndex)
        : selection.kind === "multi"
          ? buildMultiClipboardSelection(score, selection, selectedScoreIndex)
          : selection.kind === "measure"
            ? buildMeasureClipboardSelection(score, selection, selectedScoreIndex)
            : null;
  const combined = !repeatSelection
    ? regularSelection
    : !regularSelection
      ? repeatSelection
      : mergeStructuralClipboardSelection(score, regularSelection, repeatSelection);
  return combined ? withClipboardLyricMetadata(score, combined) : null;
}

function mergeStructuralClipboardSelection(
  score: Score,
  regular: CapturedSelection,
  structural: CapturedSelection,
): ClipboardSelection {
  regular = shiftSelectionOrigin(score, regular, structural.captureOrigin);
  const partDelta = structural.partIndex - regular.partIndex;
  const measureDelta = structural.captureOrigin.measureIndex - regular.captureOrigin.measureIndex;
  const beatDelta =
    beatsBetweenMeasures(score, regular.captureOrigin.measureIndex, structural.captureOrigin.measureIndex) +
    structural.captureOrigin.beat -
    regular.captureOrigin.beat;
  const shiftedOffset = (offset: [number, number]): [number, number] =>
    exactCaptureFraction((offset[0] / offset[1]) * 4 + beatDelta);
  const structuralDynamics = (structural.dynamics ?? []).map((dynamic) => ({
    ...dynamic,
    partOffset: (dynamic.partOffset ?? 0) + partDelta,
    measureOffset: dynamic.measureOffset + measureDelta,
    ...(dynamic.offset ? { offset: shiftedOffset(dynamic.offset) } : {}),
    ...(dynamic.endOffset ? { endOffset: shiftedOffset(dynamic.endOffset) } : {}),
    ...(dynamic.endMeasureOffset === undefined ? {} : { endMeasureOffset: dynamic.endMeasureOffset + measureDelta }),
  }));
  return {
    ...regular,
    measureRepeats: structural.measureRepeats?.map((repeat) => ({
      ...repeat,
      partOffset: repeat.partOffset + partDelta,
      measureOffset: repeat.measureOffset + measureDelta,
    })),
    dynamics: [...(regular.dynamics ?? []), ...structuralDynamics],
    chordSymbols: [...(regular.chordSymbols ?? []), ...(structural.chordSymbols ?? [])],
    cutMeasureRepeats: structural.cutMeasureRepeats,
  };
}

function buildMeasureRepeatClipboardSelection(score: Score, selection: SelectionState): CapturedSelection | null {
  const elementIds = measureRepeatElementIdsForSelection(score, selection);
  if (elementIds.length === 0) return null;
  const locations = elementIds.flatMap((elementId) => {
    const match = elementId.match(/^p(\d+)\/m(\d+)\/measurerepeat$/);
    return match ? [{ partIndex: Number.parseInt(match[1]!, 10), measureIndex: Number.parseInt(match[2]!, 10) }] : [];
  });
  if (locations.length === 0) return null;
  const startPart = Math.min(...locations.map((location) => location.partIndex));
  const startMeasure = Math.min(...locations.map((location) => location.measureIndex));
  const endMeasure = Math.max(...locations.map((location) => location.measureIndex));
  const measureRepeats: CapturedMeasureRepeat[] = locations.flatMap((location) => {
    const repeat = score.parts[location.partIndex]?.measures[location.measureIndex]?.measureRepeat;
    return repeat
      ? [
          {
            partOffset: location.partIndex - startPart,
            measureOffset: location.measureIndex - startMeasure,
            repeat: structuredClone(repeat),
          },
        ]
      : [];
  });
  const selectedParts = [...new Set(locations.map((location) => location.partIndex))];
  const dynamics = selectedParts.flatMap((partIndex) =>
    collectDynamics(score, partIndex, startMeasure, endMeasure, 0, Infinity).map((dynamic) => ({
      ...dynamic,
      partOffset: partIndex - startPart,
    })),
  );
  const { time, key } = resolveActiveTimeKey(score, startMeasure);
  return {
    captureOrigin: { measureIndex: startMeasure, beat: 0 },
    events: [],
    timeSignature: time,
    keySignature: key,
    clef: getActiveClef(score, startPart, startMeasure),
    transposition: score.parts[startPart]?.transposition,
    dynamics: dynamics.length > 0 ? dynamics : undefined,
    measureRepeats,
    cutMeasureRepeats: locations,
    partIndex: startPart,
    measureIndex: startMeasure,
    sequenceIndex: 0,
    eventIndex: 0,
  };
}

function buildSingleClipboardSelection(
  score: Score,
  selection: Extract<SelectionState, { kind: "single" }>,
  selectedScoreIndex?: number,
): CapturedSelection | null {
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
  const sourceStaff = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex]?.staff ?? 1;
  const sourceStaves = new Set([sourceStaff]);
  const startBeat = eventStartBeat(score, loc);
  const endBeat = startBeat + sequenceContentBeats(event);
  return {
    captureOrigin: { measureIndex: loc.measureIndex, beat: startBeat },
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
    dynamics: collectDynamics(
      score,
      loc.partIndex,
      loc.measureIndex,
      loc.measureIndex,
      startBeat,
      endBeat,
      sourceStaves,
    ).map((captured) => ({ ...captured, staffOffset: 0 })),
    chordSymbols: captureEventChordSymbols(score, loc, startBeat, endBeat, selectedScoreIndex),
    cutLocations: routed,
  };
}

function buildMultiClipboardSelection(
  score: Score,
  selection: Extract<SelectionState, { kind: "multi" }>,
  selectedScoreIndex?: number,
): CapturedSelection | null {
  if (selection.rhythmicRange)
    return captureTimedSelection(score, selection, selection.rhythmicRange, selectedScoreIndex);
  const events: SequenceContent[] = [];
  let firstLoc: { partIndex: number; measureIndex: number; sequenceIndex: number; eventIndex: number } | null = null;
  const locations =
    selectedScoreIndex === undefined
      ? selection.elementIds
          .filter((elementId) => !isLyricId(elementId))
          .flatMap((elementId) => {
            const location = resolveEventFromSubElement(elementId, score) ?? resolveEventLocation(elementId, score);
            return location ? [location] : [];
          })
      : resolveCondensedSelectionEvents(score, withoutSelectedLyrics(selection), selectedScoreIndex);
  const annotationLocations = resolveClipboardChordLocations(
    score,
    selection.elementIds
      .map(clipboardAnnotationLocation)
      .filter((location): location is AnnotationLocation => location !== null),
    eventChordSources(score, locations),
    selectedScoreIndex,
  );
  const cutAnnotationLocations =
    selectedScoreIndex === undefined
      ? annotationLocations
      : expandCondensedDynamicLocations(score, annotationLocations, selectedScoreIndex);
  locations.sort(
    (left, right) =>
      left.measureIndex - right.measureIndex || eventStartBeat(score, left) - eventStartBeat(score, right),
  );
  for (const loc of locations) {
    const event = getEventAtLocation(score, loc);
    if (!event) continue;
    if (!firstLoc) firstLoc = loc;
    events.push(event);
  }
  if (events.length === 0 || !firstLoc) return null;
  const trackMap = new Map<string, ClipboardTrack>();
  const { partIndex: startPart, staffOffset: anchorStaffOffset } = selectionStaffAnchor(score, locations);
  const origin = selectedChordSymbolOrigin(
    score,
    cutAnnotationLocations,
    selectedDynamicOrigin(score, cutAnnotationLocations, {
      measureIndex: firstLoc.measureIndex,
      beat: eventStartBeat(score, firstLoc),
    }),
  );
  for (const location of locations) {
    const sourceEvent = getEventAtLocation(score, location);
    if (!sourceEvent) continue;
    const staff =
      score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex]?.staff ?? 1;
    const voiceIndex = voiceIndexWithinStaff(score, location.partIndex, location.measureIndex, location.sequenceIndex);
    const key = `${location.partIndex}/${staff}/${voiceIndex}`;
    const track = trackMap.get(key) ?? {
      partOffset: location.partIndex - startPart,
      voiceIndex,
      staffOffset: partStaffOffset(score, startPart, location.partIndex, staff) - anchorStaffOffset,
      sourceStaff: staff,
      content: [],
    };
    if (track.content.length === 0) {
      const onset =
        beatsBetweenMeasures(score, origin.measureIndex, location.measureIndex) + eventStartBeat(score, location);
      if (onset - origin.beat > 1e-9) track.leadIn = exactCaptureDifference(onset, origin.beat);
    }
    track.content.push(sourceEvent);
    trackMap.set(key, track);
  }
  const tracks = [...trackMap.values()].sort((left, right) => left.staffOffset! - right.staffOffset!);
  const capturedDynamics = captureSelectedDynamics(score, cutAnnotationLocations, origin);
  assignDynamicsToTracks(score, startPart, tracks, capturedDynamics, anchorStaffOffset);
  const { time, key } = resolveActiveTimeKey(score, firstLoc.measureIndex);
  return {
    captureOrigin: origin,
    events,
    timeSignature: time,
    keySignature: key,
    partIndex: startPart,
    measureIndex: firstLoc.measureIndex,
    sequenceIndex: firstLoc.sequenceIndex,
    eventIndex: firstLoc.eventIndex,
    tracks: tracks.length > 1 || tracks[0]?.leadIn ? tracks : undefined,
    dynamics: tracks[0]?.dynamics,
    chordSymbols: captureSelectedChordSymbols(score, cutAnnotationLocations, origin, startPart, anchorStaffOffset),
    cutLocations: locations,
    cutAnnotationLocations: chordCutLocations(cutAnnotationLocations),
  };
}

function eventStartBeat(score: Score, location: EventLocation): number {
  const sequence = score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex];
  if (!sequence) return 0;
  return sequence.content
    .slice(0, location.tupletIndex ?? location.eventIndex)
    .reduce((sum, item) => sum + sequenceContentBeats(item), 0);
}

interface RangeResolved {
  range: NonNullable<ReturnType<typeof resolveSelectionMeasureRange>>;
  selectedIds: Set<string>;
  chordSources?: ChordRange["chordSources"];
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
  const chordRange = resolveChordClipboardRange(
    score,
    selection.startElementId,
    selection.endElementId,
    selectedScoreIndex,
    selection.measureAnchor,
    selection.measureFocus,
  );
  if (chordRange !== undefined) return chordRange;
  const selectedIds = new Set(
    resolveRangeElementIds(
      selection.startElementId,
      selection.endElementId,
      score,
      selection.measureAnchor,
      selection.measureFocus,
    ),
  );
  const range =
    resolveSelectionMeasureRange(
      selection.startElementId,
      selection.endElementId,
      score,
      selection.measureAnchor,
      selection.measureFocus,
    ) ??
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

function groupByTrack(score: Score, startPart: number, trackedEvents: TrackedEvent[]): Map<string, TrackedEvent[]> {
  const trackMap = new Map<string, TrackedEvent[]>();
  for (const te of trackedEvents) {
    const partIndex = startPart + te.partOffset;
    const staff = score.parts[partIndex]?.measures[te.measureIndex]?.sequences[te.voiceIndex]?.staff ?? 1;
    const voice = voiceIndexWithinStaff(score, partIndex, te.measureIndex, te.voiceIndex);
    const key = `${te.partOffset}:${staff}:${voice}`;
    if (!trackMap.has(key)) trackMap.set(key, []);
    trackMap.get(key)!.push(te);
  }
  return trackMap;
}

function appendTrackGap(track: ClipboardTrack, end: number, start: number): void {
  if (end - start > 1e-9) track.content.push({ type: "space", duration: exactCaptureDifference(end, start) });
}

function buildTrackFromEvents(
  score: Score,
  range: Pick<RangeResolved["range"], "startPart" | "startMeasure">,
  events: TrackedEvent[],
  anchorStaffOffset: number,
  selectionStartBeat: number,
  selectionEndBeat?: number,
): ClipboardTrack {
  const first = events[0]!;
  const srcPartIndex = range.startPart + first.partOffset;
  const staff = score.parts[srcPartIndex]?.measures[first.measureIndex]?.sequences[first.voiceIndex]?.staff ?? 1;
  const track: ClipboardTrack = {
    partOffset: first.partOffset,
    voiceIndex: voiceIndexWithinStaff(score, srcPartIndex, first.measureIndex, first.voiceIndex),
    staffOffset: partStaffOffset(score, range.startPart, srcPartIndex, staff) - anchorStaffOffset,
    sourceStaff: staff,
    content: [],
    clef: getActiveClef(score, srcPartIndex, range.startMeasure),
    transposition: score.parts[srcPartIndex]?.transposition,
  };
  const leadIn = first.absBeat - selectionStartBeat;
  if (leadIn > 1e-9) {
    track.leadIn = exactCaptureDifference(first.absBeat, selectionStartBeat);
  }
  let endBeat = first.absBeat;
  for (const te of events) {
    appendTrackGap(track, te.absBeat, endBeat);
    track.content.push(te.event);
    endBeat = te.absBeat + te.eventBeats;
  }
  if (selectionEndBeat !== undefined) appendTrackGap(track, selectionEndBeat, endBeat);
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
): CapturedSelection | null {
  const resolved = resolveRangeAndIds(score, selection, selectedScoreIndex);
  if (!resolved) return null;
  const { range, selectedIds } = resolved;
  const { events: trackedEvents } = collectTrackedEvents(score, range, selectedIds);
  if (trackedEvents.length === 0) return null;
  const selectedStaves = new Set(
    trackedEvents.map((event) => {
      const partIndex = range.startPart + event.partOffset;
      const staff = score.parts[partIndex]?.measures[event.measureIndex]?.sequences[event.voiceIndex]?.staff ?? 1;
      return `${partIndex}:${staff}`;
    }),
  );
  const annotationLocations = resolveClipboardChordLocations(
    score,
    [...selectedIds]
      .map((id) => {
        const annotation = clipboardAnnotationLocation(id);
        const source = resolved.chordSources?.get(id);
        const location =
          annotation && source ? { ...annotation, partIndex: source.partIndex, sourceStaff: source.staff } : annotation;
        if (!location || id === selection.startElementId || id === selection.endElementId) return location;
        const staff = dynamicStaffAtLocation(score, location) ?? chordSymbolStaffAtLocation(score, location);
        return staff === undefined ||
          location.partIndex === undefined ||
          selectedStaves.has(`${location.partIndex}:${staff}`)
          ? location
          : null;
      })
      .filter((location): location is AnnotationLocation => location !== null),
    trackedEvents.map((event) => ({
      partIndex: range.startPart + event.partOffset,
      staff:
        score.parts[range.startPart + event.partOffset]?.measures[event.measureIndex]?.sequences[event.voiceIndex]
          ?.staff ?? 1,
    })),
    selectedScoreIndex,
  );
  const cutAnnotationLocations =
    selectedScoreIndex === undefined
      ? annotationLocations
      : expandCondensedDynamicLocations(score, annotationLocations, selectedScoreIndex);
  const origin = selectedChordSymbolOrigin(
    score,
    cutAnnotationLocations,
    selectedDynamicOrigin(score, cutAnnotationLocations, {
      measureIndex: trackedEvents[0]!.measureIndex,
      beat: trackedEvents[0]!.sortKey,
    }),
  );
  const selectionStartBeat = beatsBetweenMeasures(score, range.startMeasure, origin.measureIndex) + origin.beat;
  const isCrossPart = new Set(trackedEvents.map((event) => event.partOffset)).size > 1;

  const trackMap = groupByTrack(score, range.startPart, trackedEvents);
  const tracks: ClipboardTrack[] = [];
  const trackAnchor = firstPhysicalTrack(score, range.startPart, trackedEvents);
  const anchorPart = range.startPart + trackAnchor.partOffset;
  const anchorStaff =
    score.parts[anchorPart]?.measures[trackAnchor.measureIndex]?.sequences[trackAnchor.voiceIndex]?.staff ?? 1;
  const anchorStaffOffset = Math.min(
    partStaffOffset(score, range.startPart, anchorPart, anchorStaff),
    selectedChordStaffOffset(score, annotationLocations, range.startPart),
  );
  for (const [, events] of trackMap) {
    tracks.push(buildTrackFromEvents(score, range, events, anchorStaffOffset, selectionStartBeat));
  }
  if (isCrossPart) padMissingPartTracks(score, range, tracks);
  tracks.sort(
    (a, b) => (a.staffOffset ?? a.partOffset) - (b.staffOffset ?? b.partOffset) || a.voiceIndex - b.voiceIndex,
  );
  const selectedDynamics = captureSelectedDynamics(score, cutAnnotationLocations, origin);

  const primaryEvents: SequenceContent[] = tracks.length > 0 ? tracks[0]!.content : [];
  if (primaryEvents.length === 0) return null;
  const lastMeasureEvents = trackedEvents.filter((event) => event.measureIndex === range.endMeasure);
  const lastMeasureBeat =
    lastMeasureEvents.length > 0
      ? Math.max(...lastMeasureEvents.map((event) => event.sortKey + event.eventBeats))
      : Infinity;
  const dynamics = [...new Set(trackedEvents.map((event) => range.startPart + event.partOffset))].flatMap((partIndex) =>
    collectDynamics(
      score,
      partIndex,
      origin.measureIndex,
      range.endMeasure,
      origin.beat,
      lastMeasureBeat,
      sourceStavesForPart(tracks, partIndex - range.startPart),
    ).map((captured) => ({ ...captured, partIndex, sourceMeasureIndex: origin.measureIndex + captured.measureOffset })),
  );
  assignDynamicsToTracks(score, range.startPart, tracks, [...selectedDynamics, ...dynamics], anchorStaffOffset);
  const seenChords = new Map<ChordSymbol, CapturedChordSymbol>();
  const chordSymbols = Array.from(
    { length: range.endPart - range.startPart + 1 },
    (_, offset) => range.startPart + offset,
  ).flatMap((partIndex) =>
    captureChordSymbols(
      score,
      partIndex,
      origin.measureIndex,
      range.endMeasure,
      origin.beat,
      lastMeasureBeat,
      partIndex - range.startPart,
      anchorStaffOffset,
      sourceStavesForPart(tracks, partIndex - range.startPart),
      { locations: cutAnnotationLocations, selectedScoreIndex, seen: seenChords },
    ),
  );

  const { time, key } = resolveActiveTimeKey(score, range.startMeasure);
  return {
    captureOrigin: origin,
    events: primaryEvents,
    timeSignature: time,
    keySignature: key,
    clef: getActiveClef(score, range.startPart, range.startMeasure),
    transposition: score.parts[range.startPart]?.transposition,
    tracks: tracks.length > 1 || tracks[0]?.leadIn || tracks[0]?.staffOffset ? tracks : undefined,
    dynamics: tracks[0]?.partOffset === 0 ? tracks[0].dynamics : undefined,
    chordSymbols,
    partIndex: range.startPart,
    measureIndex: range.startMeasure,
    sequenceIndex: range.startVoice,
    eventIndex: 0,
    cutLocations: trackedEvents.every((event) => event.location !== undefined)
      ? trackedEvents.map((event) => event.location!)
      : undefined,
    cutAnnotationLocations: chordCutLocations(cutAnnotationLocations),
  };
}

function collectMeasureTracks(
  score: Score,
  startPart: number,
  endPart: number,
  startMeasure: number,
  endMeasure: number,
): { tracks: ClipboardTrack[]; locations: EventLocation[]; exact: boolean } {
  const events: TrackedEvent[] = [];
  const locations: EventLocation[] = [];
  let exact = true;
  const measureOffsets = new Map<number, number>();
  let totalBeats = 0;
  for (let measureIndex = startMeasure; measureIndex <= endMeasure; measureIndex++) {
    measureOffsets.set(measureIndex, totalBeats);
    totalBeats += measureBeats(resolveActiveTimeKey(score, measureIndex).time);
  }
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
        const sequence = measure.sequences[sequenceIndex]!;
        const fullMeasureRest = sequence.fullMeasure && sequence.content.length === 0;
        const content: SequenceContent[] = fullMeasureRest
          ? decomposeDuration(measureBeats(resolveActiveTimeKey(score, measureIndex).time)).map((duration) => ({
              type: "event",
              id: generateEventId(),
              duration,
              rest: { staffPosition: sequence.fullMeasure?.staffPosition },
            }))
          : sequence.content;
        let sortKey = 0;
        for (let eventIndex = 0; eventIndex < content.length; eventIndex++) {
          const event = content[eventIndex]!;
          const eventBeats = sequenceContentBeats(event);
          events.push({
            event,
            eventBeats,
            measureIndex,
            sortKey,
            absBeat: measureOffsets.get(measureIndex)! + sortKey,
            partOffset: partIndex - startPart,
            voiceIndex: sequenceIndex,
          });
          sortKey += eventBeats;
          if (fullMeasureRest) continue;
          if (event.type !== "event") {
            exact = false;
            continue;
          }
          locations.push({ partIndex, measureIndex, sequenceIndex, eventIndex });
        }
      }
    }
  }
  const tracks = [...groupByTrack(score, startPart, events).values()]
    .map((trackEvents) => buildTrackFromEvents(score, { startPart, startMeasure }, trackEvents, 0, 0, totalBeats))
    .sort((a, b) => a.staffOffset! - b.staffOffset! || a.voiceIndex - b.voiceIndex);
  const dynamics = [...new Set(events.map((event) => startPart + event.partOffset))].flatMap((partIndex) =>
    collectDynamics(score, partIndex, startMeasure, endMeasure, 0, Infinity).map((captured) => ({
      ...captured,
      partIndex,
      sourceMeasureIndex: startMeasure + captured.measureOffset,
    })),
  );
  assignDynamicsToTracks(score, startPart, tracks, dynamics);
  return { tracks, locations, exact };
}

function buildMeasureClipboardSelection(
  score: Score,
  selection: Extract<SelectionState, { kind: "measure" }>,
  selectedScoreIndex?: number,
): CapturedSelection | null {
  const startP = Math.min(selection.startPartIndex, selection.endPartIndex);
  const endP = Math.max(selection.startPartIndex, selection.endPartIndex);
  const startM = Math.min(selection.startMeasure, selection.endMeasure);
  const endM = Math.max(selection.startMeasure, selection.endMeasure);
  const { tracks, locations: cutLocations, exact: exactCut } = collectMeasureTracks(score, startP, endP, startM, endM);
  const primaryEvents = tracks[0]?.content ?? [];
  if (primaryEvents.length === 0) return null;
  const chordSymbols = captureMeasureChordSymbols(score, startP, endP, startM, endM, selectedScoreIndex);

  const { time, key } = resolveActiveTimeKey(score, startM);

  return {
    captureOrigin: { measureIndex: startM, beat: 0 },
    events: primaryEvents,
    timeSignature: time,
    keySignature: key,
    tracks,
    dynamics: tracks[0]?.partOffset === 0 ? tracks[0].dynamics : undefined,
    chordSymbols,
    partIndex: startP,
    measureIndex: startM,
    sequenceIndex: 0,
    eventIndex: 0,
    cutLocations: exactCut ? cutLocations : undefined,
  };
}
