/**
 * normalModeDelete — Delete/Backspace handling in normal mode.
 *
 * Extracted from normalModeHandlers.ts as one cohesive concept: every
 * selection kind's answer to the Delete key. The order the branches are tried
 * in is load-bearing, so keeping them together makes that order reviewable in
 * one place.
 */

import type { Score } from "@viritura/core";
import { isRest } from "@viritura/core";
import { deleteNote } from "../commands/noteCommands";
import {
  deleteAnnotation,
  deleteAnnotations,
  deleteGraceNote,
  expandCondensedDynamicLocations,
} from "../commands/deleteCommands";
import { isAccidentalId, removeAccidental } from "../commands/accidentalCommands";
import { isArticulationId, removeArticulation } from "../commands/articulationDeletion";
import { partitionMarkingIds, removeMarkings } from "../commands/markingSelection";
import { isNoteheadId, removeChordNoteById, thinSelectedChords } from "../commands/chordNoteDeletion";
import {
  resolveEventLocation,
  resolveAnnotationLocation,
  resolveGraceLocation,
  getEventAtLocation,
  addressesWholeEvent,
} from "../score/ElementPath";
import { resolveSelectionEvents, resolveSelectionMeasureRange } from "../store/selectionUtils";
import { cloneScore } from "../score/scoreClone";
import {
  deleteSlurByElementId,
  deleteTieByElementId,
  deleteOrnamentOrTrill,
  deleteClefByElementId,
  removeMeasureRangeFromScore,
} from "./normalModeDeleteHelpers";
import type { KeyboardHandlerContext } from "./types";
import { deleteKeySignatureByElementId } from "../commands/signatureCommands";
import {
  planCondensedEventWriteback,
  expandCondensedSpannerIds,
  expandCondensedSubElementIds,
} from "../score/condensedWriteback";
function applyDeletion(e: KeyboardEvent, ctx: KeyboardHandlerContext, newScore: Score | null): boolean {
  if (!newScore) return false;
  e.preventDefault();
  ctx.updateScore(newScore);
  ctx.clearSelection();
  return true;
}

/**
 * Delete one notehead of a chord. Returns true when the selection is settled —
 * the note was removed, or the id names nothing removable — and false when the
 * id isn't a notehead or the notehead was the event's last note, leaving the
 * caller to blank the event through its event-level path.
 */
function deleteChordNote(
  e: KeyboardEvent,
  ctx: KeyboardHandlerContext,
  score: Score,
  elementId: string,
  selectedScoreIndex: number,
  forceDirect: boolean,
): boolean {
  if (!isNoteheadId(elementId)) return false;
  const thinned = cloneScore(score);
  const ids = expandCondensedSubElementIds(score, [elementId], selectedScoreIndex, forceDirect);
  const outcomes = ids.map((id) => removeChordNoteById(thinned, id));
  if (outcomes.some((outcome) => outcome === "removed")) return applyDeletion(e, ctx, thinned);
  return outcomes.every((outcome) => outcome === "none");
}

function deleteCondensedOrnament(
  score: Score,
  elementId: string,
  markingType: "ornament" | "trill",
  selectedScoreIndex: number,
): Score | null {
  const expanded = expandCondensedSubElementIds(score, [elementId], selectedScoreIndex);
  let next = score;
  let removed = false;
  for (const id of expanded) {
    const candidate = deleteOrnamentOrTrill(next, id.replace(/\/(?:ornament|trill)$/, ""), markingType);
    if (candidate) {
      next = candidate;
      removed = true;
    }
  }
  return removed ? next : null;
}

function deleteCondensedArticulation(score: Score, elementId: string, selectedScoreIndex: number): Score | null {
  const next = cloneScore(score);
  const ids = expandCondensedSubElementIds(score, [elementId], selectedScoreIndex);
  let removed = false;
  for (const id of ids) removed = removeArticulation(next, id) !== null || removed;
  return removed ? next : null;
}

function deleteCondensedAccidental(score: Score, elementId: string, selectedScoreIndex: number): Score | null {
  const next = cloneScore(score);
  const ids = expandCondensedSubElementIds(score, [elementId], selectedScoreIndex);
  let removed = false;
  for (const id of ids) removed = removeAccidental(next, id) !== null || removed;
  return removed ? next : null;
}

function deleteCondensedSpanner(
  score: Score,
  elementId: string,
  selectedScoreIndex: number,
  remove: (score: Score, elementId: string) => Score | null,
): Score | null {
  let next = score;
  let removed = false;
  for (const id of expandCondensedSpannerIds(score, elementId, selectedScoreIndex)) {
    const candidate = remove(next, id);
    if (candidate) {
      next = candidate;
      removed = true;
    }
  }
  return removed ? next : null;
}

function deleteConnectorSelection(
  score: Score,
  elementId: string,
  selectedScoreIndex: number,
): Score | null | undefined {
  if (elementId.startsWith("slur/")) {
    return deleteCondensedSpanner(score, elementId, selectedScoreIndex, deleteSlurByElementId);
  }
  if (elementId.startsWith("tie/")) {
    return deleteCondensedSpanner(score, elementId, selectedScoreIndex, deleteTieByElementId);
  }
  return undefined;
}

function deleteCondensedWholeEvent(
  score: Score,
  selectedScoreIndex: number,
  location: NonNullable<ReturnType<typeof resolveEventLocation>>,
  forceDirect: boolean,
  granularity: "event" | "note",
): Score {
  const newScore = cloneScore(score);
  const targets = planCondensedEventWriteback(score, selectedScoreIndex, location, {
    forceDirect,
    granularity,
  }).sourceEvents;
  for (const target of targets) {
    deleteNote(newScore, {
      measureIndex: target.measureIndex,
      partIndex: target.partIndex,
      voice: target.sequenceIndex,
      eventIndex: target.eventIndex,
      tupletIndex: target.tupletIndex,
    });
  }
  return newScore;
}

function deleteStandaloneLeaf(score: Score, elementId: string, selectedScoreIndex: number): Score | null | undefined {
  if (elementId.endsWith("/key")) return deleteKeySignatureByElementId(score, elementId);
  if (isAccidentalId(elementId)) return deleteCondensedAccidental(score, elementId, selectedScoreIndex);
  if (isArticulationId(elementId)) return deleteCondensedArticulation(score, elementId, selectedScoreIndex);
  return undefined;
}

/** Delete handling for a single-element selection (annotation/ornament/slur/tie/grace/event). */
function deleteSingleSelection(
  e: KeyboardEvent,
  ctx: KeyboardHandlerContext,
  sel: {
    kind: "single";
    elementId: string;
    measureAnchor?: { isExpansion?: boolean };
  },
): void {
  const currentScore = ctx.getScore();
  if (!currentScore) return;

  // Try annotation deletion first
  const annotLoc = resolveAnnotationLocation(sel.elementId);
  if (annotLoc) {
    applyDeletion(e, ctx, deleteAnnotation(currentScore, annotLoc, ctx.getConfig().selectedScoreIndex ?? 0));
    return;
  }

  // Ornament/trill deletion
  const ornamentMatch = sel.elementId.match(/^(.+)\/(ornament|trill)$/);
  if (ornamentMatch) {
    const markingType = ornamentMatch[2]! as "ornament" | "trill";
    applyDeletion(
      e,
      ctx,
      deleteCondensedOrnament(currentScore, sel.elementId, markingType, ctx.getConfig?.().selectedScoreIndex ?? 0),
    );
    return;
  }

  const connectorResult = deleteConnectorSelection(
    currentScore,
    sel.elementId,
    ctx.getConfig?.().selectedScoreIndex ?? 0,
  );
  if (connectorResult !== undefined) {
    applyDeletion(e, ctx, connectorResult);
    return;
  }

  // Clef deletion (clef change reverts to the inherited clef)
  if (sel.elementId.endsWith("/clef")) {
    applyDeletion(e, ctx, deleteClefByElementId(currentScore, sel.elementId));
    return;
  }

  // Key signatures and event-level leaf markings must never fall through to
  // whole-event deletion. Merged markings route across every source first.
  const leafResult = deleteStandaloneLeaf(currentScore, sel.elementId, ctx.getConfig?.().selectedScoreIndex ?? 0);
  if (leafResult !== undefined) {
    applyDeletion(e, ctx, leafResult);
    return;
  }

  // Grace note deletion (must precede regular event-delete fallback)
  const graceLoc = resolveGraceLocation(sel.elementId, currentScore);
  if (graceLoc) {
    e.preventDefault();
    const newScore = deleteGraceNote(currentScore, graceLoc);
    ctx.updateScore(newScore);
    ctx.clearSelection();
    return;
  }

  // One notehead of a chord: that note goes, the chord stays. Falls through to
  // the event path only when it was the event's last note, since an event with
  // no notes is a rest — which only the event-level primitive can produce.
  const selectedScoreIndex = ctx.getConfig?.().selectedScoreIndex ?? 0;
  const forceDirect = sel.measureAnchor?.isExpansion === true;
  if (deleteChordNote(e, ctx, currentScore, sel.elementId, selectedScoreIndex, forceDirect)) return;

  // Event/note deletion. Gated on the id actually addressing an event: an
  // unhandled sub-element would otherwise resolve to its event and blank the
  // note it sits on.
  if (!addressesWholeEvent(sel.elementId)) return;
  const loc = resolveEventLocation(sel.elementId, currentScore);
  if (!loc) return;
  const event = getEventAtLocation(currentScore, loc);
  if (!event || event.type !== "event") return;
  e.preventDefault();
  const newScore = deleteCondensedWholeEvent(
    currentScore,
    selectedScoreIndex,
    loc,
    forceDirect,
    isNoteheadId(sel.elementId) ? "note" : "event",
  );
  ctx.updateScore(newScore);
}

/** Replace all notes in a measure/part/voice range with rests (mutates `newScore`). */
function blankNotesInRange(
  newScore: Score,
  startM: number,
  endM: number,
  startP: number,
  endP: number,
  startV?: number,
  endV?: number,
): void {
  for (let p = startP; p <= Math.min(endP, newScore.parts.length - 1); p++) {
    const part = newScore.parts[p]!;
    for (let m = startM; m <= Math.min(endM, part.measures.length - 1); m++) {
      const measure = part.measures[m]!;
      const sLo = startV ?? 0;
      const sHi = Math.min(endV ?? measure.sequences.length - 1, measure.sequences.length - 1);
      for (let s = sLo; s <= sHi; s++) {
        const seq = measure.sequences[s]!;
        for (let ev = seq.content.length - 1; ev >= 0; ev--) {
          const event = seq.content[ev]!;
          if (event.type === "event" && !isRest(event)) {
            deleteNote(newScore, {
              measureIndex: m,
              partIndex: p,
              voice: s,
              eventIndex: ev,
            });
          }
        }
      }
    }
  }
}

/** Delete handling for a measure selection. */
function deleteMeasureSelection(
  e: KeyboardEvent,
  ctrlHeld: boolean,
  ctx: KeyboardHandlerContext,
  sel: {
    startMeasure?: number;
    endMeasure?: number;
    startPartIndex?: number;
    endPartIndex?: number;
  },
): void {
  const currentScore = ctx.getScore();
  if (!currentScore) return;
  const startM = Math.min(sel.startMeasure ?? 0, sel.endMeasure ?? 0);
  const endM = Math.max(sel.startMeasure ?? 0, sel.endMeasure ?? 0);
  const startP = Math.min(sel.startPartIndex ?? 0, sel.endPartIndex ?? 0);
  const endP = Math.max(sel.startPartIndex ?? 0, sel.endPartIndex ?? 0);

  if (ctrlHeld) {
    const newScore = removeMeasureRangeFromScore(currentScore, startM, endM);
    if (!newScore) return;
    e.preventDefault();
    ctx.updateScore(newScore);
    ctx.clearSelection();
    return;
  }

  e.preventDefault();
  const newScore = cloneScore(currentScore);
  blankNotesInRange(newScore, startM, endM, startP, endP);
  ctx.updateScore(newScore);
}

/** Delete handling for a range selection. */
function deleteRangeSelection(
  e: KeyboardEvent,
  ctrlHeld: boolean,
  ctx: KeyboardHandlerContext,
  sel: { kind: "range"; startElementId?: string; endElementId?: string },
): void {
  const currentScore = ctx.getScore();
  if (!currentScore) return;
  if (!sel.startElementId || !sel.endElementId) return;
  const range = resolveSelectionMeasureRange(sel.startElementId, sel.endElementId, currentScore);
  if (!range) return;

  if (ctrlHeld) {
    const newScore = removeMeasureRangeFromScore(currentScore, range.startMeasure, range.endMeasure);
    if (!newScore) return;
    e.preventDefault();
    ctx.updateScore(newScore);
    ctx.clearSelection();
    return;
  }

  const newScore = cloneScore(currentScore);
  // A range is an event-to-event selection, not a rectangular bar command.
  // Only the resolved covered events are replaced with rests; Ctrl/Cmd+Delete
  // above remains the explicit whole-measure removal action.
  const events = resolveSelectionEvents(
    { kind: "range", startElementId: sel.startElementId, endElementId: sel.endElementId },
    currentScore,
  );
  if (events.length === 0) return;
  for (const loc of [...events].reverse()) {
    try {
      deleteNote(newScore, {
        measureIndex: loc.measureIndex,
        partIndex: loc.partIndex,
        voice: loc.sequenceIndex,
        eventIndex: loc.eventIndex,
        tupletIndex: loc.tupletIndex,
      });
    } catch {
      /* event vanished under a prior delete — skip */
    }
  }
  e.preventDefault();
  ctx.updateScore(newScore);
  ctx.clearSelection();
}

/** Delete grace IDs after ordinary events, resolving each against the latest score as containers shift. */
function deleteSelectedGraceNotes(score: Score, graceIds: readonly string[]): Score {
  let next = score;
  for (const id of graceIds) {
    const location = resolveGraceLocation(id, next);
    if (location) next = deleteGraceNote(next, location);
  }
  return next;
}

/** Delete handling for a multi selection: blank every selected event to a rest. */
function deleteMultiSelection(e: KeyboardEvent, ctx: KeyboardHandlerContext): void {
  const currentScore = ctx.getScore();
  if (!currentScore) return;
  const selection = ctx.getSelection();

  // Markings selected explicitly (ctrl-click) delete on their own; only the
  // rest of the selection is event-level. Without this split they resolve to
  // their events and blank the notes they belong to.
  const selectedIds =
    selection.kind === "multi"
      ? expandCondensedSubElementIds(currentScore, selection.elementIds, ctx.getConfig?.().selectedScoreIndex ?? 0)
      : [];
  const connectorIds = selectedIds.filter((id) => id.startsWith("slur/") || id.startsWith("tie/"));
  const graceIds = selectedIds.filter((id) => resolveGraceLocation(id, currentScore) !== null);
  const annotationLocations = selectedIds.map(resolveAnnotationLocation).filter((loc) => loc !== null);
  const annotationIds = new Set(selectedIds.filter((id) => resolveAnnotationLocation(id) !== null));
  const { markingIds, eventIds } = partitionMarkingIds(
    selectedIds.filter((id) => !annotationIds.has(id) && !connectorIds.includes(id)),
  );

  // Same gate as the single path: only ids addressing a whole event may reach
  // event deletion, so an unhandled sub-element is a no-op rather than data loss.
  const deletableEventIds = eventIds.filter(addressesWholeEvent);
  const annotationsResult =
    annotationLocations.length > 0
      ? deleteAnnotations(
          currentScore,
          expandCondensedDynamicLocations(currentScore, annotationLocations, ctx.getConfig?.().selectedScoreIndex ?? 0),
        )
      : null;
  let newScore = annotationsResult ?? cloneScore(currentScore);
  const annotationsRemoved = annotationsResult !== null;
  let connectorsRemoved = false;
  for (const connectorId of connectorIds) {
    const next = deleteConnectorSelection(newScore, connectorId, ctx.getConfig?.().selectedScoreIndex ?? 0);
    if (next) {
      newScore = next;
      connectorsRemoved = true;
    }
  }

  // Noteheads thin their chords first. A chord also selected as a whole event
  // is left to the event pass — selecting everything means the rest, not a
  // chord with nothing in it.
  const wholeEventIds = deletableEventIds.filter((id) => !isNoteheadId(id));
  const chordsRemoved = thinSelectedChords(newScore, deletableEventIds, wholeEventIds);

  const eventSelection = { ...selection, elementIds: wholeEventIds };
  const events = wholeEventIds.length > 0 ? resolveSelectionEvents(eventSelection, currentScore) : [];
  const markingsRemoved = markingIds.length > 0 && removeMarkings(newScore, markingIds);
  if (
    events.length === 0 &&
    !annotationsRemoved &&
    !markingsRemoved &&
    !chordsRemoved &&
    !connectorsRemoved &&
    graceIds.length === 0
  )
    return;

  e.preventDefault();
  // Delete back-to-front so earlier indices stay valid as the merge-adjacent-rests
  // pass inside deleteNote may shrink the top-level content array.
  for (const loc of [...events].reverse()) {
    try {
      deleteNote(newScore, {
        partIndex: loc.partIndex,
        measureIndex: loc.measureIndex,
        voice: loc.sequenceIndex,
        eventIndex: loc.eventIndex,
        tupletIndex: loc.tupletIndex,
      });
    } catch {
      /* event vanished under a prior delete — skip */
    }
  }
  ctx.updateScore(deleteSelectedGraceNotes(newScore, graceIds));
  ctx.clearSelection();
}

/** Delete selected note, annotation, or measure range. */
export function handleDelete(e: KeyboardEvent, ctrlHeld: boolean, ctx: KeyboardHandlerContext): void {
  const sel = ctx.getSelection();
  if (sel.kind === "single" && sel.elementId) {
    deleteSingleSelection(e, ctx, sel as { kind: "single"; elementId: string });
    return;
  }
  if (sel.kind === "multi") {
    deleteMultiSelection(e, ctx);
    return;
  }
  if (sel.kind === "measure") {
    deleteMeasureSelection(e, ctrlHeld, ctx, sel);
    return;
  }
  if (sel.kind === "range") {
    deleteRangeSelection(e, ctrlHeld, ctx, sel);
  }
}
