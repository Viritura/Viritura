import { measureBeats, walkSequenceEvents, type Score, type SequenceContent } from "@viritura/core";
import { applyPaste, type PasteResult } from "../commands/clipboardCommands";
import { sequenceContentBeats } from "../commands/noteCommands";
import { assignFreshTrackIds } from "./deserialize";
import type { ClipboardSelection } from "../commands/clipboardCommands";
import { findPlacedSelection } from "./computePasteResult";
import type { SelectionState } from "../store/selectionStore";
import { partStaffOffset, voiceIndexWithinStaff } from "./clipboardTrackMapping";
import { ensureSequencePosition, splitSequenceAtBeat } from "./clipboardTrackPlacement";
import { ensurePasteMeasure, sequenceForStaffVoice } from "./pasteContent";
import { beatsBetweenMeasures, findPlacedAnnotationIds, resolvePhysicalStaffDestination } from "./annotations";

function repeatSourceLocations(score: Score, sel: ClipboardSelection): NonNullable<ClipboardSelection["cutLocations"]> {
  if (sel.cutLocations?.length) return sel.cutLocations;

  // Container ranges do not have cut locations. Their original event IDs still
  // identify the top-level rhythmic units, including whole tuplets and tremolos.
  const ids = new Set<string>();
  for (const content of [sel.events, ...(sel.tracks ?? []).map((track) => track.content)]) {
    for (const { event } of walkSequenceEvents(content)) {
      if (event.id) ids.add(event.id);
    }
  }
  const locations: NonNullable<ClipboardSelection["cutLocations"]> = [];
  for (const [partIndex, part] of score.parts.entries()) {
    for (let measureIndex = sel.measureIndex; measureIndex < part.measures.length; measureIndex++) {
      for (const [sequenceIndex, sequence] of part.measures[measureIndex]!.sequences.entries()) {
        for (const [eventIndex, item] of sequence.content.entries()) {
          if ([...walkSequenceEvents([item])].some(({ event }) => event.id && ids.has(event.id))) {
            locations.push({ partIndex, measureIndex, sequenceIndex, eventIndex });
          }
        }
      }
    }
  }
  return locations;
}

function capturedRepeatEnd(score: Score, sel: ClipboardSelection, sourceEnds: ReadonlyMap<string, number>) {
  if (!sel.captureOrigin) return undefined;
  const origin = sel.captureOrigin;
  const tracks = sel.tracks?.length ? sel.tracks : [{ content: sel.events, leadIn: undefined }];
  let beat = Math.max(
    ...tracks.map((track) => {
      let end = origin.beat + (track.leadIn ? (track.leadIn[0] / track.leadIn[1]) * 4 : 0);
      for (const item of track.content) {
        const ends = [...walkSequenceEvents([item])].flatMap(({ event }) => {
          const sourceEnd = event.id ? sourceEnds.get(event.id) : undefined;
          return sourceEnd === undefined ? [] : [sourceEnd];
        });
        // Source endpoints already include tuplet scaling and selection gaps.
        // Only locationless content, such as synthesized rests, adds duration.
        end = ends.length ? Math.max(...ends) : end + sequenceContentBeats(item);
      }
      return end;
    }),
  );
  let { measureIndex } = origin;
  if (!Number.isFinite(beat)) return undefined;
  let time = { count: 4, unit: 4 };
  for (let index = 0; index <= measureIndex; index++) {
    if (score.global.measures[index]?.time) time = score.global.measures[index]!.time!;
  }
  while (true) {
    const capacity = measureBeats(time);
    if (capacity <= 1e-9 || !Number.isFinite(capacity)) return undefined;
    if (beat <= capacity + 1e-9) return { measureIndex, beat };
    beat -= capacity;
    measureIndex++;
    if (score.global.measures[measureIndex]?.time) time = score.global.measures[measureIndex]!.time!;
  }
}

function repeatEnd(
  score: Score,
  sel: ClipboardSelection,
  locations: NonNullable<ClipboardSelection["cutLocations"]>,
): { measureIndex: number; beat: number } {
  let end: { measureIndex: number; beat: number } | undefined;
  const sourceEnds = new Map<string, number>();
  for (const location of locations) {
    const content =
      score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex]?.content;
    const index = location.tupletIndex ?? location.eventIndex;
    if (!content?.[index]) continue;
    const beat = content.slice(0, index + 1).reduce((sum, item) => sum + sequenceContentBeats(item), 0);
    if (sel.captureOrigin) {
      const sourceEnd = beatsBetweenMeasures(score, sel.captureOrigin.measureIndex, location.measureIndex) + beat;
      for (const { event } of walkSequenceEvents([content[index]])) {
        if (event.id) sourceEnds.set(event.id, sourceEnd);
      }
    }
    if (
      !end ||
      location.measureIndex > end.measureIndex ||
      (location.measureIndex === end.measureIndex && beat > end.beat)
    ) {
      end = { measureIndex: location.measureIndex, beat };
    }
  }
  const capturedEnd = capturedRepeatEnd(score, sel, sourceEnds);
  if (
    capturedEnd &&
    (!end ||
      capturedEnd.measureIndex > end.measureIndex ||
      (capturedEnd.measureIndex === end.measureIndex && capturedEnd.beat > end.beat))
  ) {
    end = capturedEnd;
  }
  if (end) return end;

  // Legacy callers without source locations or IDs describe a local content slice.
  const content = score.parts[sel.partIndex]?.measures[sel.measureIndex]?.sequences[sel.sequenceIndex]?.content ?? [];
  return {
    measureIndex: sel.measureIndex,
    beat: content
      .slice(0, sel.eventIndex + sel.events.length)
      .reduce((sum, item) => sum + sequenceContentBeats(item), 0),
  };
}

function primarySourceContext(
  score: Score,
  sel: ClipboardSelection,
  locations: NonNullable<ClipboardSelection["cutLocations"]>,
) {
  const primaryTrack = sel.tracks
    ?.filter((track) => track.staffOffset === 0)
    .sort((left, right) => left.voiceIndex - right.voiceIndex)[0];
  const sourceTrack =
    primaryTrack?.sourceStaff !== undefined
      ? primaryTrack
      : sel.tracks?.find((track) => track.sourceStaff !== undefined && track.staffOffset !== undefined);
  if (sourceTrack?.sourceStaff !== undefined && sourceTrack.staffOffset !== undefined) {
    // Track offsets include empty leading staves and parts. Subtract the offset
    // from the original physical source staff, not the first populated sequence.
    const originOffset =
      partStaffOffset(score, sel.partIndex, sel.partIndex + sourceTrack.partOffset, sourceTrack.sourceStaff) -
      sourceTrack.staffOffset;
    const origin = resolvePhysicalStaffDestination(score, sel.partIndex, 0, originOffset);
    return { partIndex: origin.partIndex, staff: origin.staffIndex + 1, voice: primaryTrack?.voiceIndex ?? 0 };
  }
  const ids = new Set(
    [...walkSequenceEvents(primaryTrack?.content ?? sel.events)]
      .map(({ event }) => event.id)
      .filter((id) => id !== undefined),
  );
  const source =
    locations.find((location) => {
      if (location.partIndex !== sel.partIndex) return false;
      const item =
        score.parts[location.partIndex]?.measures[location.measureIndex]?.sequences[location.sequenceIndex]?.content[
          location.tupletIndex ?? location.eventIndex
        ];
      return item && [...walkSequenceEvents([item])].some(({ event }) => event.id && ids.has(event.id));
    }) ?? sel;
  const sequence = score.parts[sel.partIndex]?.measures[source.measureIndex]?.sequences[source.sequenceIndex];
  if (!sequence) return null;
  return {
    partIndex: sel.partIndex,
    staff: sequence.staff ?? 1,
    voice: voiceIndexWithinStaff(score, sel.partIndex, source.measureIndex, source.sequenceIndex),
  };
}

function repeatAnchor(score: Score, sel: ClipboardSelection) {
  const locations = repeatSourceLocations(score, sel);
  // Range endpoint sequence indices need not identify the physically first
  // clipboard track when a bar stores its staves in a different order.
  const primary = primarySourceContext(score, sel, locations);
  if (!primary) return null;
  const { partIndex, staff, voice } = primary;
  const { measureIndex, beat } = repeatEnd(score, sel, locations);
  const sequences = score.parts[partIndex]?.measures[measureIndex]?.sequences;
  const target = sequences?.filter((sequence) => (sequence.staff ?? 1) === staff)[voice];
  const physicalTrackStartBeat =
    sel.tracks?.length && sel.tracks.every((track) => track.staffOffset !== undefined) ? beat : undefined;
  if (target && physicalTrackStartBeat !== undefined) {
    return {
      score,
      partIndex,
      measureIndex,
      sequenceIndex: sequences!.indexOf(target),
      eventIndex: 0,
      physicalTrackStartBeat,
    };
  }
  if (target) {
    let onset = 0;
    for (let eventIndex = 0; eventIndex <= target.content.length; eventIndex++) {
      if (Math.abs(onset - beat) < 1e-9) {
        return { score, partIndex, measureIndex, sequenceIndex: sequences!.indexOf(target), eventIndex };
      }
      const item = target.content[eventIndex];
      if (item) onset += sequenceContentBeats(item);
    }
  }

  // Another selected voice can finish later, inside a primary-voice rest or
  // beyond its content. Prepare that beat without moving the primary context.
  const prepared = structuredClone(score);
  ensurePasteMeasure(prepared, measureIndex);
  const destination = prepared.parts[partIndex]!.measures[measureIndex]!.sequences;
  const sequence = sequenceForStaffVoice(destination, staff, voice);
  if (physicalTrackStartBeat === undefined) {
    ensureSequencePosition(sequence.content, beat);
    splitSequenceAtBeat(sequence.content, beat);
  }
  let onset = 0;
  let eventIndex = 0;
  while (eventIndex < sequence.content.length && onset < beat - 1e-9) {
    onset += sequenceContentBeats(sequence.content[eventIndex++]!);
  }
  return {
    score: prepared,
    partIndex,
    measureIndex,
    sequenceIndex: destination.indexOf(sequence),
    eventIndex,
    physicalTrackStartBeat,
  };
}

/**
 * Build a fresh `PasteResult` from a clipboard-style selection, then paste it
 * immediately after the current selection. Returns the updated score and the
 * complete placed selection plus a legacy ID range, or `null` if the inputs aren't actionable.
 */
export function computeRepeatResult(
  score: Score,
  sel: ClipboardSelection,
): {
  newScore: Score;
  range: { start: string; end: string } | null;
  selection: SelectionState | null;
  warnings: string[];
} | null {
  const anchor = repeatAnchor(score, sel);
  if (!anchor) return null;
  const pasteResult: PasteResult = {
    ...assignFreshTrackIds(sel.events, sel.tracks),
    sourceTimeSignature: sel.timeSignature,
    sourceKeySignature: sel.keySignature,
    dynamics: sel.dynamics,
    chordSymbols: sel.chordSymbols,
  };

  const { partIndex, measureIndex, sequenceIndex, eventIndex } = anchor;
  const placedContent: SequenceContent[] = [];
  const warnings: string[] = [];
  const newScore = applyPaste(
    anchor.score,
    pasteResult,
    partIndex,
    measureIndex,
    sequenceIndex,
    eventIndex,
    placedContent,
    anchor.physicalTrackStartBeat,
    (message) => warnings.push(message),
  );
  const startBeat =
    anchor.physicalTrackStartBeat ??
    anchor.score.parts[partIndex]!.measures[measureIndex]!.sequences[sequenceIndex]!.content.slice(
      0,
      eventIndex,
    ).reduce((sum, item) => sum + sequenceContentBeats(item), 0);
  const annotationIds = findPlacedAnnotationIds(anchor.score, newScore, pasteResult, {
    partIndex,
    measureIndex,
    beat: startBeat,
    staffIndex: (anchor.score.parts[partIndex]!.measures[measureIndex]!.sequences[sequenceIndex]!.staff ?? 1) - 1,
  });
  return {
    newScore,
    ...findPlacedSelection(newScore, placedContent, measureIndex, startBeat, annotationIds),
    warnings: [...new Set(warnings)],
  };
}
