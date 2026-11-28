import { walkSequenceEvents, type NoteEvent, type Score, type SequenceContent } from "@viritura/core";

export function collectNoteIds(content: SequenceContent[], ids: Set<string>): void {
  for (const { event } of walkSequenceEvents(content)) {
    for (const note of [...(event.notes ?? []), ...(event.kitNotes ?? [])]) {
      if (note.id) ids.add(note.id);
    }
  }
}

export function dropReferencesToNotes(score: Score, removedIds: ReadonlySet<string>): void {
  if (removedIds.size === 0) return;
  for (const part of score.parts) {
    for (const measure of part.measures) {
      for (const sequence of measure.sequences) {
        for (const { event } of walkSequenceEvents(sequence.content)) {
          pruneEventReferences(event, removedIds);
        }
      }
    }
  }
}

function pruneEventReferences(event: NoteEvent, removedIds: ReadonlySet<string>): void {
  for (const note of [...(event.notes ?? []), ...(event.kitNotes ?? [])]) {
    if (!note.ties) continue;
    const kept = note.ties.filter((tie) => !(tie.target !== undefined && removedIds.has(tie.target)));
    if (kept.length === note.ties.length) continue;
    if (kept.length === 0) delete note.ties;
    else note.ties = kept;
  }

  for (const slur of event.slurs ?? []) {
    if (slur.startNote !== undefined && removedIds.has(slur.startNote)) delete slur.startNote;
    if (slur.endNote !== undefined && removedIds.has(slur.endNote)) delete slur.endNote;
  }
}
