import type { Note, NoteMarkings, Score } from "@viritura/core";
import { produce } from "immer";
import type { SelectionState } from "../store/selectionStore";
import { getEventAtLocation } from "../score/ElementPath";
import { planSelectionWriteback } from "../score/condensedWriteback";

export type NoteMarkingChange =
  | { key: "slideIn"; type: NonNullable<NoteMarkings["slideIn"]>["type"] }
  | { key: "slideOut"; type: NonNullable<NoteMarkings["slideOut"]>["type"] };

interface NoteTarget {
  location: ReturnType<typeof planSelectionWriteback>["sourceNotes"][number];
  noteIndex: number;
}

function resolveTargets(score: Score, selection: SelectionState, selectedScoreIndex?: number): NoteTarget[] {
  const targets = planSelectionWriteback(score, selection, selectedScoreIndex).sourceNotes;
  const notes: NoteTarget[] = [];
  const seen = new Set<string>();
  for (const location of targets) {
    const event = getEventAtLocation(score, location);
    if (event?.type !== "event" || !event.notes) continue;
    const indices = location.noteIndex === undefined ? event.notes.map((_, index) => index) : [location.noteIndex];
    for (const noteIndex of indices) {
      const note = event.notes[noteIndex];
      if (!note) continue;
      const key = `${location.partIndex}/${location.measureIndex}/${location.sequenceIndex}/${location.eventIndex}/${noteIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      notes.push({ location, noteIndex });
    }
  }
  return notes;
}

function readMarking(note: Note, change: NoteMarkingChange): NoteMarkings[NoteMarkingChange["key"]] {
  return change.key === "slideIn" ? note.markings?.slideIn : note.markings?.slideOut;
}

/** Toggle a note marking only on the selected noteheads (not sibling chord notes). */
export function applyNoteMarkingToSelection(
  score: Score,
  selection: SelectionState,
  change: NoteMarkingChange,
  selectedScoreIndex?: number,
): Score | null {
  const targets = resolveTargets(score, selection, selectedScoreIndex);
  if (targets.length === 0) return null;

  const targetOn = !targets.every(({ location, noteIndex }) => {
    const event = getEventAtLocation(score, location);
    const note = event?.type === "event" ? event.notes?.[noteIndex] : undefined;
    return note !== undefined && readMarking(note, change)?.type === change.type;
  });
  const updated = produce(score, (draft) => {
    for (const { location, noteIndex } of targets) {
      const event = getEventAtLocation(draft, location);
      if (event?.type !== "event") continue;
      const note = event.notes?.[noteIndex];
      if (!note) continue;
      if (change.key === "slideIn") {
        if (targetOn) {
          note.markings ??= {};
          note.markings.slideIn = { ...note.markings.slideIn, type: change.type };
        } else if (note.markings?.slideIn?.type === change.type) {
          delete note.markings.slideIn;
        }
      } else if (targetOn) {
        note.markings ??= {};
        note.markings.slideOut = { ...note.markings.slideOut, type: change.type };
      } else if (note.markings?.slideOut?.type === change.type) {
        delete note.markings.slideOut;
      }
      if (note.markings && Object.keys(note.markings).length === 0) delete note.markings;
    }
  });
  return updated === score ? null : updated;
}
