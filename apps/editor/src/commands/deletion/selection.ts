import type { Score, NoteEvent, SequenceContent, Sequence } from "@viritura/core";
import { isRest } from "@viritura/core";
import { deleteLeafTarget, deleteLeafTargets, deletionOperations, resolveDeletionTarget } from "./operations";
import { deleteEventTargets } from "./eventTargets";
import type { SelectionState } from "../../store/selectionStore";
import { deleteAnnotations, deleteGraceNote, deleteSelectedGraceNotes } from "../deleteCommands";
import { sequenceContentBeats } from "../noteCommands";
import { isNoteheadId, thinSelectedChords } from "../chordNoteDeletion";
import { resolveSelectionEvents } from "../../store/selectionUtils";
import {
  resolveEventLocation,
  getEventAtLocation,
  resolveGraceLocation,
  addressesWholeEvent,
} from "../../score/ElementPath";
import type { AnnotationLocation, GraceLocation } from "../../score/ElementPath";
import { deleteMeasureRepeatsForSelection, measureRepeatElementIdsForSelection } from "../measureRepeatCommands";
import { expandCondensedSubElementIds, planCondensedEventWriteback } from "../../score/condensedWriteback";
import { cloneScore } from "../../score/scoreClone";
import { clearMeasureContent } from "../measureContent";

type DeleteSelectionResult =
  | { kind: "noop" }
  | { kind: "single"; score: Score; nextSelection: { kind: "select"; elementId: string } | { kind: "clear" } }
  | { kind: "multi"; score: Score; nextSelection: { kind: "clear" } }
  | { kind: "measure"; score: Score };

type SingleSel = Extract<SelectionState, { kind: "single" }>;
type MultiOrRangeSel = Extract<SelectionState, { kind: "multi" | "range" }>;
type MeasureSel = Extract<SelectionState, { kind: "measure" }>;
type TimedPartAnnotation = {
  position: { fraction: [number, number] };
  voice?: string;
};

/**
 * Compute the result of deleting the current selection. Pure function with
 * no side effects — callers apply the returned score + selection updates
 * themselves. Returns `{ kind: "noop" }` when there's nothing to delete.
 */
export function computeDeleteSelection(
  score: Score | null,
  selection: SelectionState,
  scoreIndex = 0,
): DeleteSelectionResult {
  if (!score || selection.kind === "none") return { kind: "noop" };
  const original = score;
  score = cloneScore(original);
  const result =
    selection.kind === "single"
      ? deleteSingle(score, selection, scoreIndex)
      : selection.kind === "measure"
        ? deleteMeasure(score, selection)
        : deleteMultiOrRange(score, selection, scoreIndex);
  return result.kind !== "noop" && JSON.stringify(result.score) === JSON.stringify(original)
    ? { kind: "noop" }
    : result;
}

function deleteSingle(score: Score, selection: SingleSel, scoreIndex: number): DeleteSelectionResult {
  if (!selection.elementId) return { kind: "noop" };
  const elementId = selection.elementId;

  const standaloneResult = deleteStandaloneElement(score, selection, scoreIndex);
  if (standaloneResult) return standaloneResult;

  // Grace notes live inside a `{type:"grace"}` container — handle before the
  // regular event path, otherwise the parent event (the one the grace adorns)
  // would be replaced with a rest.
  const graceLoc = resolveGraceLocation(elementId, score);
  if (graceLoc) {
    const newScore = deleteGraceNote(score, graceLoc);
    const parentId = graceParentElementId(newScore, graceLoc);
    return {
      kind: "single",
      score: newScore,
      nextSelection: parentId ? { kind: "select", elementId: parentId } : { kind: "clear" },
    };
  }

  // Everything past this point deletes the whole event, so only ids that
  // address one may reach it. Without this an unhandled sub-element — a
  // fingering, an augmentation dot, or a typo — resolves to its event and
  // blanks the note it sits on.
  if (!addressesWholeEvent(elementId)) return { kind: "noop" };

  const loc = resolveEventLocation(elementId, score);
  if (!loc) return { kind: "noop" };
  const event = getEventAtLocation(score, loc);
  if (!event || event.type !== "event") return { kind: "noop" };

  const tremoloContainerIndex =
    loc.tupletIndex !== undefined &&
    score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex]?.content[loc.tupletIndex]
      ?.type === "tremolo"
      ? loc.tupletIndex
      : undefined;
  const result = deleteMultiOrRange(
    score,
    {
      kind: "multi",
      elementIds: [elementId],
      measureAnchor: selection.measureAnchor,
    },
    scoreIndex,
  );
  if (result.kind === "noop") return result;
  const newScore = result.score;
  const thinnedChord = isPartialChordSelection(elementId, event);

  // Select a surviving rest in the same container; never jump out of a tuplet.
  const sequence = newScore.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
  const deletedIndex = tremoloContainerIndex === undefined ? loc.eventIndex : tremoloContainerIndex + loc.eventIndex;
  const nextId =
    sequence && !thinnedChord
      ? findAdjacentElementId(
          sequence,
          deletedIndex,
          loc.partIndex,
          loc.measureIndex,
          loc.sequenceIndex,
          tremoloContainerIndex === undefined ? loc.tupletIndex : undefined,
        )
      : undefined;
  return {
    kind: "single",
    score: newScore,
    nextSelection: nextId ? { kind: "select", elementId: nextId } : { kind: "clear" },
  };
}

function isPartialChordSelection(elementId: string, event: NoteEvent): boolean {
  return isNoteheadId(elementId) && (event.notes?.length ?? 0) + (event.kitNotes?.length ?? 0) > 1;
}

/** Delete a selected leaf or global property that must never fall through to its parent event. */
function deleteStandaloneElement(score: Score, selection: SingleSel, scoreIndex: number): DeleteSelectionResult | null {
  const { elementId } = selection;
  const target = resolveDeletionTarget(elementId);
  if (deletionOperations[target.kind].kind === "event") return null;
  const next = deleteLeafTarget(score, target, {
    scoreIndex,
    forceDirect: selection.measureAnchor?.isExpansion === true,
  });
  return next ? { kind: "single", score: next, nextSelection: { kind: "clear" } } : { kind: "noop" };
}

/** Resolve the element ID of the event a deleted grace note adorned. */
function graceParentElementId(score: Score, graceLoc: GraceLocation): string | undefined {
  const seq = score.parts[graceLoc.partIndex]?.measures[graceLoc.measureIndex]?.sequences[graceLoc.sequenceIndex];
  if (!seq) return undefined;
  const containerArr: SequenceContent[] | undefined =
    graceLoc.tupletIndex !== undefined
      ? (() => {
          const t = seq.content[graceLoc.tupletIndex!];
          return t && t.type === "tuplet" ? (t.content as SequenceContent[]) : undefined;
        })()
      : (seq.content as SequenceContent[]);
  if (!containerArr) return undefined;
  // After splice the parent event sits at graceContainerIndex when the
  // container was removed, otherwise at graceContainerIndex + 1.
  const parentIdx =
    containerArr[graceLoc.graceContainerIndex]?.type === "grace"
      ? graceLoc.graceContainerIndex + 1
      : graceLoc.graceContainerIndex;
  const parent = containerArr[parentIdx] as NoteEvent | undefined;
  if (parent?.id) {
    return `p${graceLoc.partIndex}/m${graceLoc.measureIndex}/s${graceLoc.sequenceIndex}/${parent.id}`;
  }
  return undefined;
}

/** Find an element ID near a deleted index to re-anchor the selection. */
function findAdjacentElementId(
  sequence: Sequence,
  deletedIndex: number,
  partIndex: number,
  measureIndex: number,
  seqIndex: number,
  tupletIndex?: number,
): string | undefined {
  const container = tupletIndex === undefined ? undefined : sequence.content[tupletIndex];
  const content = tupletIndex === undefined ? sequence.content : container?.type === "tuplet" ? container.content : [];
  // Try the same index (the replacement rest), then the neighbors.
  const candidates = [deletedIndex, deletedIndex - 1, deletedIndex + 1];
  for (const idx of candidates) {
    if (idx >= 0 && idx < content.length) {
      const ev = content[idx]!;
      if (ev.type === "event" && ev.id && isRest(ev)) {
        return `p${partIndex}/m${measureIndex}/s${seqIndex}/${ev.id}`;
      }
    }
  }
  return undefined;
}

function deleteMultiOrRange(score: Score, selection: MultiOrRangeSel, scoreIndex: number): DeleteSelectionResult {
  score = cloneScore(score);
  const forceDirect = selection.measureAnchor?.isExpansion === true;
  if (selection.kind === "multi") {
    selection = {
      ...selection,
      elementIds: expandCondensedSubElementIds(score, selection.elementIds, scoreIndex, forceDirect),
    };
  }
  const repeatResult = deleteRepeatOnlySelection(score, selection);
  if (repeatResult) return repeatResult;
  // Markings selected explicitly (ctrl-click) delete on their own; only the
  // rest of the selection is event-level. Without this split they resolve to
  // their events and blank the notes they belong to.
  //
  // Only a `multi` selection can name a marking: a range expands through the
  // navigation index, whose entries are events, so shift-selecting across an
  // accidental selects the music — which is what a range should mean.
  const leaves =
    selection.kind === "multi"
      ? deleteLeafTargets(score, selection.elementIds, {
          scoreIndex,
          forceDirect: selection.measureAnchor?.isExpansion === true,
        })
      : null;
  if (leaves) score = leaves;
  const graceIds =
    selection.kind === "multi" ? selection.elementIds.filter((id) => resolveGraceLocation(id, score) !== null) : [];
  const deletableIds =
    selection.kind === "multi"
      ? selection.elementIds.filter(
          (id) => addressesWholeEvent(id) && deletionOperations[resolveDeletionTarget(id).kind].kind === "event",
        )
      : [];

  // Noteheads thin their chords first; a chord whose every notehead is selected
  // (or which is also selected as a whole event) is left to the event pass,
  // since an event with no notes is a rest.
  const wholeEventIds = deletableIds.filter((id) => !isNoteheadId(id));
  const chordsThinned = selection.kind === "multi" && thinSelectedChords(score, deletableIds, wholeEventIds);

  const eventSelection: MultiOrRangeSel =
    selection.kind === "multi"
      ? {
          ...selection,
          // `addressesWholeEvent` also excludes the marking ids, since a marking
          // never addresses its whole event — that is the whole point of it.
          elementIds: wholeEventIds,
        }
      : selection;

  // The primitive returns the covered events de-duplicated (multiple sub-element
  // IDs collapse to one event) and in ascending document order. Reversing gives
  // descending order, so earlier deletions don't shift indices we still need.
  const visualEvents =
    eventSelection.kind === "multi" && eventSelection.elementIds.length === 0
      ? []
      : resolveSelectionEvents(eventSelection, score);
  const sourceEvents =
    selection.kind === "multi"
      ? visualEvents
      : visualEvents.flatMap(
          (loc) => planCondensedEventWriteback(score, scoreIndex, loc, { forceDirect }).sourceEvents,
        );
  const events = [
    ...new Map(
      sourceEvents.map((loc) => [
        `${loc.partIndex}/${loc.measureIndex}/${loc.sequenceIndex}/${loc.tupletIndex ?? -1}/${loc.eventIndex}`,
        loc,
      ]),
    ).values(),
  ].sort(
    (a, b) =>
      a.partIndex - b.partIndex ||
      a.measureIndex - b.measureIndex ||
      a.sequenceIndex - b.sequenceIndex ||
      (a.tupletIndex ?? a.eventIndex) - (b.tupletIndex ?? b.eventIndex) ||
      a.eventIndex - b.eventIndex,
  );

  let newScore = score;
  const annotationResult = deleteTimedAnnotationsAnchoredToCollapsedSequences(newScore, events);
  newScore = annotationResult.score;
  const leavesRemoved = leaves !== null;
  if (events.length === 0) {
    const graceRemoved = deleteSelectedGraceNotes(newScore, graceIds);
    return didDeleteSelectionLeaves(leavesRemoved, annotationResult.removed, chordsThinned, graceRemoved !== newScore)
      ? { kind: "multi", score: graceRemoved, nextSelection: { kind: "clear" } }
      : { kind: "noop" };
  }

  newScore = deleteEventTargets(newScore, events);
  return { kind: "multi", score: deleteSelectedGraceNotes(newScore, graceIds), nextSelection: { kind: "clear" } };
}

function didDeleteSelectionLeaves(
  markingsOrLyricsRemoved: boolean,
  annotationsRemoved: boolean,
  chordsThinned: boolean,
  graceNotesRemoved: boolean,
): boolean {
  return markingsOrLyricsRemoved || annotationsRemoved || chordsThinned || graceNotesRemoved;
}

function deleteTimedAnnotationsAnchoredToCollapsedSequences(
  score: Score,
  events: ReturnType<typeof resolveSelectionEvents>,
): { score: Score; removed: boolean } {
  const locations = timedAnnotationsAnchoredToCollapsedSequences(score, events);
  const withoutAnnotations = locations.length > 0 ? deleteAnnotations(score, locations) : null;
  return withoutAnnotations ? { score: withoutAnnotations, removed: true } : { score, removed: false };
}

/**
 * Timed part annotations are anchored to a top-level sequence item. Deleting
 * every event in a sequence collapses its roots into one full-measure rest, so
 * remove annotations whose anchors would otherwise disappear with that tree.
 */
export function timedAnnotationsAnchoredToCollapsedSequences(
  score: Score,
  events: ReturnType<typeof resolveSelectionEvents>,
): AnnotationLocation[] {
  const selectedBySequence = new Map<string, Set<string>>();
  for (const loc of events) {
    const sequenceKey = `${loc.partIndex}/${loc.measureIndex}/${loc.sequenceIndex}`;
    const rootIndex = loc.tupletIndex ?? loc.eventIndex;
    const childIndex = loc.tupletIndex === undefined ? -1 : loc.eventIndex;
    const selectedRoots = selectedBySequence.get(sequenceKey) ?? new Set<string>();
    selectedRoots.add(`${rootIndex}/${childIndex}`);
    selectedBySequence.set(sequenceKey, selectedRoots);
  }

  const locations: AnnotationLocation[] = [];
  for (const [sequenceKey, selectedRoots] of selectedBySequence) {
    const [partText, measureText, sequenceText] = sequenceKey.split("/");
    if (!partText || !measureText || !sequenceText) continue;
    const partIndex = Number(partText);
    const measureIndex = Number(measureText);
    const sequenceIndex = Number(sequenceText);
    const measure = score.parts[partIndex]?.measures[measureIndex];
    const sequence = measure?.sequences[sequenceIndex];
    if (!measure || !sequence || !willSequenceCollapse(sequence.content, selectedRoots)) continue;

    const voice = sequence.voice ?? `v${sequenceIndex + 1}`;
    const allSequencesCollapse = measure.sequences.every((candidate, candidateIndex) => {
      if (!candidate) return false;
      return willSequenceCollapse(
        candidate.content,
        selectedBySequence.get(`${partIndex}/${measureIndex}/${candidateIndex}`) ?? new Set<string>(),
      );
    });
    locations.push(
      ...timedAnnotationLocationsAtSelectedRoots(
        measure,
        partIndex,
        measureIndex,
        sequence.content,
        voice,
        allSequencesCollapse,
      ),
    );
  }
  return locations;
}

function willSequenceCollapse(content: SequenceContent[], selectedRoots: ReadonlySet<string>): boolean {
  return (
    content.length > 0 &&
    content.every((item, rootIndex) => {
      if (item.type === "event") return selectedRoots.has(`${rootIndex}/-1`);
      if (item.type !== "tuplet" && item.type !== "tremolo") return false;
      return item.content.every((_, childIndex) => selectedRoots.has(`${rootIndex}/${childIndex}`));
    })
  );
}

function timedAnnotationLocationsAtSelectedRoots(
  measure: Score["parts"][number]["measures"][number],
  partIndex: number,
  measureIndex: number,
  content: SequenceContent[],
  voice: string,
  removeUnscopedAnnotations: boolean,
): AnnotationLocation[] {
  const locations: AnnotationLocation[] = [];
  const isAnchoredInSequence = (annotation: TimedPartAnnotation): boolean =>
    (annotation.voice === voice || (annotation.voice === undefined && removeUnscopedAnnotations)) &&
    content.some((item, index) => {
      const start = content.slice(0, index).reduce((total, previous) => total + sequenceContentBeats(previous), 0);
      const end = start + sequenceContentBeats(item);
      const beat = (annotation.position.fraction[0] / annotation.position.fraction[1]) * 4;
      return beat >= start - 1e-9 && beat < end - 1e-9;
    });

  for (const [index, dynamic] of (measure.dynamics ?? []).entries()) {
    if (!isAnchoredInSequence(dynamic)) continue;
    locations.push({
      kind: "part",
      type: dynamic.type === "gradual" ? "hairpin" : "dyn",
      partIndex,
      measureIndex,
      annotationIndex: index,
      annotationId: dynamic.id,
    });
  }
  for (const [index, pedal] of (measure.pedals ?? []).entries()) {
    if (isAnchoredInSequence(pedal))
      locations.push({ kind: "part", type: "pedal", partIndex, measureIndex, annotationIndex: index });
  }
  for (const [index, ottava] of (measure.ottavas ?? []).entries()) {
    if (isAnchoredInSequence(ottava))
      locations.push({ kind: "part", type: "ottava", partIndex, measureIndex, annotationIndex: index });
  }
  for (const [index, expression] of (measure.expressions ?? []).entries()) {
    if (isAnchoredInSequence(expression))
      locations.push({ kind: "part", type: "expr", partIndex, measureIndex, annotationIndex: index });
  }
  return locations;
}

function deleteRepeatOnlySelection(score: Score, selection: MultiOrRangeSel): DeleteSelectionResult | null {
  const repeatIds = measureRepeatElementIdsForSelection(score, selection);
  const isRepeatOnlySelection =
    selection.kind === "range" ? repeatIds.length > 0 : repeatIds.length === selection.elementIds.length;
  if (!isRepeatOnlySelection) return null;
  const withoutRepeats = deleteMeasureRepeatsForSelection(score, selection);
  return withoutRepeats ? { kind: "multi", score: withoutRepeats, nextSelection: { kind: "clear" } } : { kind: "noop" };
}

function deleteMeasure(score: Score, selection: MeasureSel): DeleteSelectionResult {
  return { kind: "measure", score: clearMeasureContent(score, selection) };
}
