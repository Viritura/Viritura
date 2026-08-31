// Pure extraction of handleDeleteSelection from App.tsx.
// Computes the new Score + next selection from the current Score + Selection,
// with no React or store dependencies.
import type { Score, NoteEvent, SequenceContent, Sequence } from "@viritura/core";
import { isRest } from "@viritura/core";
import type { SelectionState } from "../store/selectionStore";
import { deleteAnnotation, deleteGraceNote } from "./deleteCommands";
import { deleteNote } from "./noteCommands";
import { isAccidentalId, removeAccidental } from "./accidentalCommands";
import { isArticulationId, removeArticulation } from "./articulationDeletion";
import { partitionMarkingIds, removeMarkings } from "./markingSelection";
import { isNoteheadId, removeChordNoteById, thinSelectedChords } from "./chordNoteDeletion";
import { resolveSelectionEvents } from "../store/selectionUtils";
import {
  resolveEventLocation,
  getEventAtLocation,
  resolveAnnotationLocation,
  resolveGraceLocation,
  addressesWholeEvent,
} from "../score/ElementPath";
import type { GraceLocation } from "../score/ElementPath";
import { deleteKeySignatureByElementId } from "./signatureCommands";

export type DeleteSelectionResult =
  | { kind: "noop" }
  | { kind: "single"; score: Score; nextSelection: { kind: "select"; elementId: string } | { kind: "clear" } }
  | { kind: "multi"; score: Score; nextSelection: { kind: "clear" } }
  | { kind: "measure"; score: Score };

type SingleSel = Extract<SelectionState, { kind: "single" }>;
type MultiOrRangeSel = Extract<SelectionState, { kind: "multi" | "range" }>;
type MeasureSel = Extract<SelectionState, { kind: "measure" }>;
type SequenceEntry = Score["parts"][number]["measures"][number]["sequences"][number]["content"][number];

/**
 * Compute the result of deleting the current selection. Pure function with
 * no side effects — callers apply the returned score + selection updates
 * themselves. Returns `{ kind: "noop" }` when there's nothing to delete.
 */
export function computeDeleteSelection(score: Score | null, selection: SelectionState): DeleteSelectionResult {
  if (!score || selection.kind === "none") return { kind: "noop" };
  if (selection.kind === "single") return deleteSingle(score, selection);
  if (selection.kind === "multi" || selection.kind === "range") return deleteMultiOrRange(score, selection);
  return deleteMeasure(score, selection);
}

function deleteSingle(score: Score, selection: SingleSel): DeleteSelectionResult {
  if (!selection.elementId) return { kind: "noop" };
  const elementId = selection.elementId;

  const annotationLocation = resolveAnnotationLocation(elementId);
  if (annotationLocation) {
    const withoutAnnotation = deleteAnnotation(score, annotationLocation);
    if (!withoutAnnotation) return { kind: "noop" };
    return { kind: "single", score: withoutAnnotation, nextSelection: { kind: "clear" } };
  }

  const standaloneResult = deleteStandaloneElement(score, elementId);
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

  // One notehead of a chord: that note goes and the chord stays. Falls through
  // to the event path only when it was the event's last note — an event with no
  // notes is a rest, which only `deleteNote` knows how to make.
  const chordResult = deleteChordNote(score, elementId);
  if (chordResult) return chordResult;

  // Everything past this point deletes the whole event, so only ids that
  // address one may reach it. Without this an unhandled sub-element — a
  // fingering, an augmentation dot, or a typo — resolves to its event and
  // blanks the note it sits on.
  if (!addressesWholeEvent(elementId)) return { kind: "noop" };

  const loc = resolveEventLocation(elementId, score);
  if (!loc) return { kind: "noop" };
  const event = getEventAtLocation(score, loc);
  // Can only delete notes, not rests (rests are structural).
  if (!event || event.type !== "event" || isRest(event)) return { kind: "noop" };

  const tremoloContainerIndex =
    loc.tupletIndex !== undefined &&
    score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex]?.content[loc.tupletIndex]
      ?.type === "tremolo"
      ? loc.tupletIndex
      : undefined;
  const newScore = deleteNote(score, {
    measureIndex: loc.measureIndex,
    partIndex: loc.partIndex,
    voice: loc.sequenceIndex,
    eventIndex: loc.eventIndex,
    tupletIndex: loc.tupletIndex,
  });

  // Move selection to the replacement rest (same index), else an adjacent event.
  const sequence = newScore.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
  const deletedIndex = tremoloContainerIndex === undefined ? loc.eventIndex : tremoloContainerIndex + loc.eventIndex;
  const nextId = sequence
    ? findAdjacentElementId(sequence, deletedIndex, loc.partIndex, loc.measureIndex, loc.sequenceIndex)
    : undefined;
  return {
    kind: "single",
    score: newScore,
    nextSelection: nextId ? { kind: "select", elementId: nextId } : { kind: "clear" },
  };
}

/** Delete a selected leaf or global property that must never fall through to its parent event. */
function deleteStandaloneElement(score: Score, elementId: string): DeleteSelectionResult | null {
  // An accidental deletes to a respelling of its note, not to a rest, so it
  // has to be caught before the event path replaces the whole event.
  //
  // Selection clears rather than falling back to the note: the thing that was
  // selected no longer exists, and re-selecting its note would leave a
  // selection the user never asked for — one keystroke away from deleting the
  // note itself.
  if (isAccidentalId(elementId)) {
    const respelled = removeAccidental(score, elementId);
    if (!respelled) return { kind: "noop" };
    return { kind: "single", score: respelled, nextSelection: { kind: "clear" } };
  }

  // Likewise an articulation: only the marking goes, never the note.
  if (isArticulationId(elementId)) {
    const stripped = removeArticulation(score, elementId);
    if (!stripped) return { kind: "noop" };
    return { kind: "single", score: stripped, nextSelection: { kind: "clear" } };
  }

  // MNX key signatures are global-measure properties even though the renderer
  // emits one selectable copy per staff. Removing the explicit property makes
  // this measure inherit the preceding key; note pitches stay unchanged, so
  // layout automatically displays any accidentals the inherited key requires.
  if (elementId.endsWith("/key")) {
    const withoutKey = deleteKeySignatureByElementId(score, elementId);
    if (!withoutKey) return { kind: "noop" };
    return { kind: "single", score: withoutKey, nextSelection: { kind: "clear" } };
  }
  return null;
}

/**
 * Delete one notehead of a chord. Returns null when the id isn't a notehead, or
 * when the notehead was the event's last note — in both cases the caller
 * continues down its whole-event path.
 *
 * Selection clears for the same reason an accidental's does: the notehead that
 * was selected no longer exists, and re-selecting its event would leave a
 * selection the user never asked for.
 */
function deleteChordNote(score: Score, elementId: string): DeleteSelectionResult | null {
  if (!isNoteheadId(elementId)) return null;
  const outcome = removeChordNoteById(score, elementId);
  if (outcome === "removed") return { kind: "single", score, nextSelection: { kind: "clear" } };
  return outcome === "none" ? { kind: "noop" } : null;
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
): string | undefined {
  // Try the same index (the replacement rest), then the neighbors.
  const candidates = [deletedIndex, deletedIndex - 1, deletedIndex + 1];
  for (const idx of candidates) {
    if (idx >= 0 && idx < sequence.content.length) {
      const ev = sequence.content[idx]! as NoteEvent;
      if (ev.id) {
        return `p${partIndex}/m${measureIndex}/s${seqIndex}/${ev.id}`;
      }
    }
  }
  return undefined;
}

function deleteMultiOrRange(score: Score, selection: MultiOrRangeSel): DeleteSelectionResult {
  // Markings selected explicitly (ctrl-click) delete on their own; only the
  // rest of the selection is event-level. Without this split they resolve to
  // their events and blank the notes they belong to.
  //
  // Only a `multi` selection can name a marking: a range expands through the
  // navigation index, whose entries are events, so shift-selecting across an
  // accidental selects the music — which is what a range should mean.
  const markingIds = selection.kind === "multi" ? partitionMarkingIds(selection.elementIds).markingIds : [];
  const graceIds =
    selection.kind === "multi" ? selection.elementIds.filter((id) => resolveGraceLocation(id, score) !== null) : [];
  const deletableIds = selection.kind === "multi" ? selection.elementIds.filter(addressesWholeEvent) : [];

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
  const events =
    eventSelection.kind === "multi" && eventSelection.elementIds.length === 0
      ? []
      : resolveSelectionEvents(eventSelection, score);

  let newScore = score;
  const markingsRemoved = markingIds.length > 0 && removeMarkings(newScore, markingIds);
  if (events.length === 0) {
    const graceRemoved = deleteSelectedGraceNotes(newScore, graceIds);
    return markingsRemoved || chordsThinned || graceRemoved !== newScore
      ? { kind: "multi", score: graceRemoved, nextSelection: { kind: "clear" } }
      : { kind: "noop" };
  }

  const ordered = [...events].reverse();
  const tremoloContainers = new Set(
    events.flatMap((loc) => {
      if (loc.tupletIndex === undefined) return [];
      const item =
        score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex]?.content[loc.tupletIndex];
      return item?.type === "tremolo"
        ? [`${loc.partIndex}/${loc.measureIndex}/${loc.sequenceIndex}/${loc.tupletIndex}`]
        : [];
    }),
  );
  const unwrappedTremolos = new Set<string>();

  for (const loc of ordered) {
    try {
      const containerKey =
        loc.tupletIndex === undefined
          ? null
          : `${loc.partIndex}/${loc.measureIndex}/${loc.sequenceIndex}/${loc.tupletIndex}`;
      const wasTremolo = containerKey !== null && tremoloContainers.has(containerKey);
      const usesRestoredTopLevelIndex = wasTremolo && containerKey !== null && unwrappedTremolos.has(containerKey);
      newScore = deleteNote(newScore, {
        partIndex: loc.partIndex,
        measureIndex: loc.measureIndex,
        voice: loc.sequenceIndex,
        eventIndex: usesRestoredTopLevelIndex ? loc.tupletIndex! + loc.eventIndex : loc.eventIndex,
        tupletIndex: usesRestoredTopLevelIndex ? undefined : loc.tupletIndex,
      });
      if (wasTremolo && containerKey !== null) unwrappedTremolos.add(containerKey);
    } catch {
      // Index may have been invalidated by a merge — skip and continue.
    }
  }
  return { kind: "multi", score: deleteSelectedGraceNotes(newScore, graceIds), nextSelection: { kind: "clear" } };
}

/** Remove explicit grace-note selections after ordinary events, re-resolving IDs as containers shift. */
function deleteSelectedGraceNotes(score: Score, graceIds: readonly string[]): Score {
  let next = score;
  for (const id of graceIds) {
    const loc = resolveGraceLocation(id, next);
    if (loc) next = deleteGraceNote(next, loc);
  }
  return next;
}

function deleteMeasure(score: Score, selection: MeasureSel): DeleteSelectionResult {
  const startP = Math.min(selection.startPartIndex, selection.endPartIndex);
  const endP = Math.max(selection.startPartIndex, selection.endPartIndex);
  const startM = Math.min(selection.startMeasure, selection.endMeasure);
  const endM = Math.max(selection.startMeasure, selection.endMeasure);

  let newScore = score;
  for (let p = startP; p <= Math.min(endP, newScore.parts.length - 1); p++) {
    const part = newScore.parts[p];
    if (!part) continue;
    for (let m = startM; m <= Math.min(endM, part.measures.length - 1); m++) {
      newScore = deleteMeasureContent(newScore, p, m);
    }
  }
  return { kind: "measure", score: newScore };
}

function deleteMeasureContent(score: Score, p: number, m: number): Score {
  let next = score;
  const measure = next.parts[p]?.measures[m];
  if (!measure) return next;
  for (let s = 0; s < measure.sequences.length; s++) {
    const seq = measure.sequences[s];
    if (!seq) continue;
    // Delete back-to-front to keep indices stable.
    for (let e = seq.content.length - 1; e >= 0; e--) {
      next = deleteSequenceEntry(next, p, m, s, seq.content[e], e);
    }
  }
  return next;
}

function deleteSequenceEntry(
  score: Score,
  p: number,
  m: number,
  s: number,
  item: SequenceEntry | undefined,
  eventIndex: number,
): Score {
  if (!item) return score;
  if (item.type === "event") {
    if (!item.notes || item.notes.length === 0) return score;
    try {
      return deleteNote(score, { partIndex: p, measureIndex: m, voice: s, eventIndex });
    } catch {
      return score;
    }
  }
  if (item.type === "tremolo") {
    try {
      let next = deleteNote(score, { partIndex: p, measureIndex: m, voice: s, eventIndex: 1, tupletIndex: eventIndex });
      next = deleteNote(next, { partIndex: p, measureIndex: m, voice: s, eventIndex });
      return next;
    } catch {
      return score;
    }
  }
  if (item.type !== "tuplet") return score;
  let next = score;
  for (let ti = item.content.length - 1; ti >= 0; ti--) {
    const inner = item.content[ti];
    if (inner?.type !== "event" || !inner.notes || inner.notes.length === 0) continue;
    try {
      next = deleteNote(next, {
        partIndex: p,
        measureIndex: m,
        voice: s,
        eventIndex: ti,
        tupletIndex: eventIndex,
      });
    } catch {
      /* ignore */
    }
  }
  return next;
}
