/**
 * normalModeDeleteHelpers — slur/tie/ornament deletion plumbing extracted
 * from normalModeHandlers.ts to keep that file under the file-length limit.
 */

import type { Score, NoteEvent, Sequence } from "@viritura/core";
import { walkSequenceEvents, setClef } from "@viritura/core";
import { cloneScore } from "../score/scoreClone";
import { resolveEventLocation, getEventAtLocation } from "../score/ElementPath";
import { parseClefElementId } from "../score/clefElementId";

/**
 * Yield NoteEvents from a single sequence's content, flattening every event
 * container (tuplet/grace/tremolo). Grace notes are addressable slur/tie
 * endpoints too, so they must be visited here. Container descent lives in the
 * canonical `walkSequenceEvents` primitive so this set never drifts.
 */
function* iterSeqEvents(seqContent: Sequence["content"]): Generator<NoteEvent> {
  for (const { event } of walkSequenceEvents(seqContent)) {
    yield event;
  }
}

/** Iterate all NoteEvents in a score, yielding each event once. Flattens tuplet/tremolo containers. */
export function* iterAllEvents(score: Score): Generator<NoteEvent> {
  for (const part of score.parts) {
    for (const measure of part.measures) {
      for (const seq of measure.sequences) {
        yield* iterSeqEvents(seq.content);
      }
    }
  }
}

/** Delete a slur reference (selection elementId of form `slur/{src}/{target}`). */
export function deleteSlurByElementId(score: Score, elementId: string): Score | null {
  const slurParts = elementId.split("/");
  const srcEventModelId = slurParts[1];
  const targetEventModelId = slurParts[2];
  if (!srcEventModelId || !targetEventModelId) return null;
  const newScore = cloneScore(score);
  for (const ev of iterAllEvents(newScore)) {
    if (ev.id !== srcEventModelId || !ev.slurs) continue;
    const idx = ev.slurs.findIndex((s) => s.target === targetEventModelId);
    if (idx === -1) continue;
    ev.slurs.splice(idx, 1);
    if (ev.slurs.length === 0) delete ev.slurs;
    return newScore;
  }
  return null;
}

/** Delete a tie reference (selection elementId of form `tie/{srcNote}/{targetNote|lv}`). */
export function deleteTieByElementId(score: Score, elementId: string): Score | null {
  const tieParts = elementId.split("/");
  const srcNoteModelId = tieParts[1];
  const targetNoteModelId = tieParts[2];
  if (!srcNoteModelId || !targetNoteModelId) return null;
  const isLv = targetNoteModelId === "lv";
  const newScore = cloneScore(score);
  for (const ev of iterAllEvents(newScore)) {
    if (!ev.notes) continue;
    for (const note of ev.notes) {
      if (note.id !== srcNoteModelId || !note.ties) continue;
      const idx = note.ties.findIndex((t) => (isLv ? t.lv === true : t.target === targetNoteModelId));
      if (idx === -1) continue;
      note.ties.splice(idx, 1);
      if (note.ties.length === 0) delete note.ties;
      return newScore;
    }
  }
  return null;
}

/** Delete an ornament or trill marking from the parent event. */
export function deleteOrnamentOrTrill(score: Score, parentId: string, markingType: "ornament" | "trill"): Score | null {
  const loc = resolveEventLocation(parentId, score);
  if (!loc) return null;
  const newScore = cloneScore(score);
  const ev = getEventAtLocation(newScore, loc);
  if (!ev || ev.type !== "event" || !ev.markings) return null;
  if (markingType === "ornament") {
    delete ev.markings.ornaments;
  } else {
    delete ev.markings.trill;
  }
  if (ev.markings && Object.keys(ev.markings).length === 0) {
    delete (ev as unknown as Record<string, unknown>).markings;
  }
  return newScore;
}

/**
 * Delete a clef (selection elementId of form `p{part}/m{measure}/clef` or `.../clefN`).
 *
 * Only a clef *change* can be deleted — removing the entry reverts the staff to
 * the clef inherited from earlier measures. The part's establishing clef (the
 * first clef in the part) can't be deleted, since a staff must always have a
 * clef; selecting it and pressing Delete is a no-op. A selected system-start
 * "running" clef on a measure that has no clef of its own is likewise a no-op.
 */
function affectsSameStaff(selectedStaff: number | undefined, candidateStaff: number | undefined): boolean {
  if (selectedStaff === undefined || candidateStaff === undefined) return true;
  return selectedStaff === candidateStaff;
}

function hasEarlierClefForStaff(
  score: Score,
  partIndex: number,
  measureIndex: number,
  clefIndex: number,
  staff: number | undefined,
): boolean {
  const clefs = score.parts[partIndex]!.measures[measureIndex]!.clefs ?? [];
  for (let index = clefIndex - 1; index >= 0; index--) {
    if (affectsSameStaff(staff, clefs[index]!.staff)) return true;
  }

  for (let previousMeasureIndex = measureIndex - 1; previousMeasureIndex >= 0; previousMeasureIndex--) {
    const previousClefs = score.parts[partIndex]!.measures[previousMeasureIndex]!.clefs ?? [];
    for (let index = previousClefs.length - 1; index >= 0; index--) {
      if (affectsSameStaff(staff, previousClefs[index]!.staff)) return true;
    }
  }

  return false;
}

export function deleteClefByElementId(score: Score, elementId: string): Score | null {
  const location = parseClefElementId(elementId);
  if (!location) return null;
  const { partIndex, measureIndex, clefIndex } = location;
  const part = score.parts[partIndex];
  if (!part) return null;
  const measure = part.measures[measureIndex];
  const clefs = measure?.clefs;
  // No clef of its own here (inherited/system-start running clef) → nothing to delete.
  if (!clefs || clefs.length === 0) return null;
  const selectedClef = clefs[clefIndex];
  if (!selectedClef) return null;
  // The first clef affecting a staff must stay — a staff always needs a clef.
  if (!hasEarlierClefForStaff(score, partIndex, measureIndex, clefIndex, selectedClef.staff)) return null;
  if (clefs.length === 1) return setClef(score, measureIndex, partIndex, null);

  const next = cloneScore(score);
  const nextMeasure = next.parts[partIndex]!.measures[measureIndex]!;
  nextMeasure.clefs!.splice(clefIndex, 1);
  if (nextMeasure.clefs!.length === 0) delete nextMeasure.clefs;
  return next;
}

/** Remove measures in [startM, endM] from all parts. Returns null if it would delete all measures. */
export function removeMeasureRangeFromScore(score: Score, startM: number, endM: number): Score | null {
  const totalMeasures = score.global.measures.length;
  const count = endM - startM + 1;
  if (count >= totalMeasures) return null;
  return {
    ...score,
    global: {
      ...score.global,
      measures: [...score.global.measures.slice(0, startM), ...score.global.measures.slice(endM + 1)],
    },
    parts: score.parts.map((part) => ({
      ...part,
      measures: [...part.measures.slice(0, startM), ...part.measures.slice(endM + 1)],
    })),
  };
}
