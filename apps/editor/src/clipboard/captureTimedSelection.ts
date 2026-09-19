import type { Score, SequenceContent } from "@viritura/core";
import type { SelectionRhythmicRange, SelectionState } from "../store/selectionStore";
import {
  resolveAnnotationLocation,
  resolveEventLocation,
  resolveGraceLocation,
  type AnnotationLocation,
  type EventLocation,
} from "../score/ElementPath";
import { sequenceContentBeats } from "../commands/noteCommands";
import type { ClipboardTrack } from "./ClipboardFragment";
import {
  beatsBetweenMeasures,
  annotationInTrackRanges,
  exactCaptureDifference,
  sourceStavesForPart,
  type CapturedSelection,
} from "./annotations";
import { partStaffOffset, voiceIndexWithinStaff } from "./clipboardTrackMapping";
import { assignDynamicsToTracks, captureSelectedDynamics, dynamicStaffAtLocation } from "./dynamicCapture";
import { captureSelectedChordSymbols, chordSymbolStaffAtLocation } from "./chordSymbolCapture";

interface SelectedUnit extends EventLocation {
  content: SequenceContent;
  beat: number;
}

function selectedUnits(score: Score, elementIds: readonly string[], span: SelectionRhythmicRange): SelectedUnit[] {
  const units = new Map<string, SelectedUnit>();
  for (const elementId of elementIds) {
    const grace = resolveGraceLocation(elementId, score);
    const location = grace
      ? { ...grace, eventIndex: grace.graceContainerIndex }
      : resolveEventLocation(elementId, score);
    if (!location) continue;
    const eventIndex = location.tupletIndex ?? location.eventIndex;
    const sequence =
      score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex];
    const content = sequence?.content[eventIndex];
    if (!content) continue;
    const key = `${location.partIndex}/${location.measureIndex}/${location.sequenceIndex}/${eventIndex}`;
    units.set(key, {
      partIndex: location.partIndex,
      measureIndex: location.measureIndex,
      sequenceIndex: location.sequenceIndex,
      eventIndex,
      content,
      beat: sequence!.content.slice(0, eventIndex).reduce((sum, item) => sum + sequenceContentBeats(item), 0),
    });
  }
  for (const track of span.tracks ?? []) {
    for (let m = track.start.measureIndex; m <= track.end.measureIndex; m++) {
      const sequences = score.parts[track.partIndex]?.measures[m]?.sequences ?? [];
      const sequence = sequences.filter((sequence) => (sequence.staff ?? 1) === track.staff)[track.voice];
      if (!sequence) continue;
      let beat = 0;
      for (const [eventIndex, content] of sequence.content.entries()) {
        const endBeat = beat + sequenceContentBeats(content);
        if (
          content.type === "space" &&
          (m !== track.start.measureIndex || beat >= track.start.beat - 1e-9) &&
          (m !== track.end.measureIndex || endBeat <= track.end.beat + 1e-9)
        ) {
          const sequenceIndex = sequences.indexOf(sequence);
          units.set(`${track.partIndex}/${m}/${sequenceIndex}/${eventIndex}`, {
            partIndex: track.partIndex,
            measureIndex: m,
            sequenceIndex,
            eventIndex,
            content,
            beat,
          });
        }
        beat = endBeat;
      }
    }
  }
  return [...units.values()].sort(
    (a, b) => a.measureIndex - b.measureIndex || a.beat - b.beat || a.eventIndex - b.eventIndex,
  );
}

function appendSpace(content: SequenceContent[], end: number, start: number): void {
  if (end - start > 1e-9) content.push({ type: "space", duration: exactCaptureDifference(end, start, 1) });
}

function timedTracks(
  score: Score,
  units: SelectedUnit[],
  span: SelectionRhythmicRange,
  startPart: number,
  anchorStaffOffset: number,
): ClipboardTrack[] {
  const tracks = new Map<string, { track: ClipboardTrack; endBeat: number }>();
  for (const unit of units) {
    const staff = score.parts[unit.partIndex]!.measures[unit.measureIndex]!.sequences[unit.sequenceIndex]!.staff ?? 1;
    const voiceIndex = voiceIndexWithinStaff(score, unit.partIndex, unit.measureIndex, unit.sequenceIndex);
    const key = `${unit.partIndex}/${staff}/${voiceIndex}`;
    const beat = beatsBetweenMeasures(score, span.start.measureIndex, unit.measureIndex) + unit.beat;
    let entry = tracks.get(key);
    if (!entry) {
      const leadIn = beat - span.start.beat;
      entry = {
        track: {
          partOffset: unit.partIndex - startPart,
          staffOffset: partStaffOffset(score, startPart, unit.partIndex, staff) - anchorStaffOffset,
          sourceStaff: staff,
          voiceIndex,
          ...(leadIn > 1e-9 ? { leadIn: exactCaptureDifference(beat, span.start.beat, 1) } : {}),
          content: [],
          transposition: score.parts[unit.partIndex]?.transposition,
        },
        endBeat: beat,
      };
      for (let m = span.start.measureIndex; m >= 0; m--) {
        const clef = score.parts[unit.partIndex]?.measures[m]?.clefs?.find(
          (entry) => (entry.staff ?? 1) === staff,
        )?.clef;
        if (clef) {
          entry.track.clef = clef;
          break;
        }
      }
      tracks.set(key, entry);
    }
    appendSpace(entry.track.content, beat, entry.endBeat);
    entry.track.content.push(unit.content);
    entry.endBeat = beat + sequenceContentBeats(unit.content);
  }
  for (const { track, endBeat } of tracks.values()) {
    const end =
      span.tracks?.find(
        (range) =>
          range.partIndex === startPart + track.partOffset &&
          range.staff === track.sourceStaff &&
          range.voice === track.voiceIndex,
      )?.end ?? span.end;
    const duration = beatsBetweenMeasures(score, span.start.measureIndex, end.measureIndex) + end.beat;
    appendSpace(track.content, duration, endBeat);
  }
  return [...tracks.values()]
    .map(({ track }) => track)
    .sort((a, b) => a.staffOffset! - b.staffOffset! || a.voiceIndex - b.voiceIndex);
}

function timedAnnotationLocations(
  score: Score,
  span: SelectionRhythmicRange,
  tracks: ClipboardTrack[],
  startPart: number,
): AnnotationLocation[] {
  const locations: AnnotationLocation[] = [];
  for (const partOffset of new Set(tracks.map((track) => track.partOffset))) {
    const partIndex = startPart + partOffset;
    const staves = sourceStavesForPart(tracks, partOffset);
    for (let measureIndex = span.start.measureIndex; measureIndex <= span.end.measureIndex; measureIndex++) {
      const measure = score.parts[partIndex]?.measures[measureIndex];
      if (!measure) continue;
      const includes = (staff: number, fraction: [number, number]) => {
        const beat = (fraction[0] / fraction[1]) * 4;
        return (
          fraction[1] > 0 &&
          staves.has(staff) &&
          (measureIndex !== span.start.measureIndex || beat >= span.start.beat - 1e-9) &&
          (measureIndex !== span.end.measureIndex || beat < span.end.beat - 1e-9) &&
          annotationInTrackRanges(span.tracks, partIndex, staff, measureIndex, beat)
        );
      };
      for (const [annotationIndex, symbol] of (measure.chordSymbols ?? []).entries()) {
        if (includes(symbol.displayStaff ?? 1, symbol.position.fraction)) {
          locations.push({ kind: "part", type: "chord", partIndex, measureIndex, annotationIndex });
        }
      }
      for (const dynamic of measure.dynamics ?? []) {
        if (includes(dynamic.staff ?? 1, dynamic.position.fraction)) {
          locations.push({
            kind: "part",
            type: dynamic.type === "gradual" ? "hairpin" : "dyn",
            partIndex,
            measureIndex,
            annotationId: dynamic.id,
          });
        }
      }
    }
  }
  return locations;
}

/** Recapture a placed ID set without compacting its gaps or flattening rhythmic containers. */
export function captureTimedSelection(
  score: Score,
  selection: Extract<SelectionState, { kind: "multi" }>,
  span: SelectionRhythmicRange,
): CapturedSelection | null {
  const units = selectedUnits(score, selection.elementIds, span);
  if (units.length === 0) return null;
  const explicitLocations = selection.elementIds.flatMap((elementId) => {
    const location = resolveAnnotationLocation(elementId);
    return location ? [location] : [];
  });
  const annotationStaves = explicitLocations.flatMap((location) => {
    const staff = dynamicStaffAtLocation(score, location) ?? chordSymbolStaffAtLocation(score, location);
    return staff === undefined || location.partIndex === undefined ? [] : [{ partIndex: location.partIndex, staff }];
  });
  const sourceStaves = [
    ...units.map((unit) => ({
      partIndex: unit.partIndex,
      staff: score.parts[unit.partIndex]!.measures[unit.measureIndex]!.sequences[unit.sequenceIndex]!.staff ?? 1,
    })),
    ...annotationStaves,
  ];
  const startPart = Math.min(...sourceStaves.map((source) => source.partIndex));
  const anchorStaffOffset = Math.min(
    ...sourceStaves.map((source) => partStaffOffset(score, startPart, source.partIndex, source.staff)),
  );
  const tracks = timedTracks(score, units, span, startPart, anchorStaffOffset);
  // Explicit identities survive outside note intervals; incidental annotations still
  // belong only to occupied tracks, never untouched music before a lead-in.
  const annotationLocations = [...explicitLocations, ...timedAnnotationLocations(score, span, tracks, startPart)];
  const dynamics = captureSelectedDynamics(score, annotationLocations, span.start);
  assignDynamicsToTracks(score, startPart, tracks, dynamics, anchorStaffOffset);
  let timeSignature = { count: 4, unit: 4 };
  let keySignature = { fifths: 0 };
  for (let m = 0; m <= span.start.measureIndex; m++) {
    timeSignature = score.global.measures[m]?.time ?? timeSignature;
    keySignature = score.global.measures[m]?.key ?? keySignature;
  }
  const primary = tracks[0]!;
  const first = units.find(
    (unit) =>
      unit.partIndex === startPart + primary.partOffset &&
      (score.parts[unit.partIndex]!.measures[unit.measureIndex]!.sequences[unit.sequenceIndex]!.staff ?? 1) ===
        primary.sourceStaff &&
      voiceIndexWithinStaff(score, unit.partIndex, unit.measureIndex, unit.sequenceIndex) === primary.voiceIndex,
  )!;
  return {
    captureOrigin: span.start,
    events: tracks[0]!.content,
    tracks,
    timeSignature,
    keySignature,
    clef: tracks[0]!.clef,
    transposition: tracks[0]!.transposition,
    dynamics: tracks[0]!.dynamics,
    chordSymbols: captureSelectedChordSymbols(score, annotationLocations, span.start, startPart, anchorStaffOffset),
    partIndex: startPart,
    measureIndex: span.start.measureIndex,
    sequenceIndex: first.sequenceIndex,
    eventIndex: first.eventIndex,
    cutAnnotationLocations: explicitLocations,
    cutLocations: units.every((unit) => unit.content.type === "event" || unit.content.type === "space")
      ? units
          .filter((unit) => unit.content.type === "event")
          .map(({ partIndex, measureIndex, sequenceIndex, eventIndex }) => ({
            partIndex,
            measureIndex,
            sequenceIndex,
            eventIndex,
          }))
      : undefined,
  };
}
