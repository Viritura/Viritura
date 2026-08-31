import { useMemo } from "react";
import type { Score, NoteEvent, Note, Tie, Slur, Sequence, SequenceContent } from "@viritura/core";
import type { SelectionState } from "../../store/selectionStore";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { extractNoteIndex } from "../../score/ElementPath";

export interface NotationInspectorSelection {
  selectedEvent: SequenceContent | null;
  noteIndex: number;
  selectedNote: Note | null;
  selectedTie: Tie | null;
  selectedSlur: Slur | null;
  selectedTrill: NonNullable<NoteEvent["markings"]>["trill"] | null;
  selectedSequence: Sequence | null;
  selectedContent: SequenceContent | null;
  isTuplet: boolean;
  isEvent: boolean;
}

function resolveSelectedEvent(score: Score, target: NotationSelectionTarget): SequenceContent | null {
  if (target.sequenceIndex === undefined || target.eventIndex === undefined) return null;
  const sequence = score.parts[target.partIndex]?.measures[target.measureIndex]?.sequences[target.sequenceIndex];
  if (!sequence) return null;
  if (target.graceContainerIndex !== undefined) {
    const grace = sequence.content[target.graceContainerIndex];
    if (grace?.type === "grace") {
      return grace.content?.[target.eventIndex] ?? null;
    }
    return null;
  }
  if (target.tupletIndex !== undefined) {
    const tuplet = sequence.content[target.tupletIndex];
    if (tuplet?.type === "tuplet" || tuplet?.type === "tremolo") {
      return tuplet.content?.[target.eventIndex] ?? null;
    }
    return null;
  }
  return sequence.content[target.eventIndex] ?? null;
}

function resolveNoteIndex(selection: SelectionState, target: NotationSelectionTarget | null): number {
  if (target?.noteIndex !== undefined) return target.noteIndex;
  if (selection.kind === "single") {
    const ni = extractNoteIndex(selection.elementId);
    if (ni !== undefined) return ni;
  }
  return 0;
}

function resolveSelectedSequence(score: Score | null, target: NotationSelectionTarget | null): Sequence | null {
  if (!score || !target || target.sequenceIndex === undefined) return null;
  return score.parts[target.partIndex]?.measures[target.measureIndex]?.sequences[target.sequenceIndex] ?? null;
}

function resolveSelectedContent(
  sequence: Sequence | null,
  target: NotationSelectionTarget | null,
): SequenceContent | null {
  if (!sequence || target?.eventIndex === undefined) return null;
  return sequence.content[target.eventIndex] ?? null;
}

function buildSelection(
  selection: SelectionState,
  score: Score | null,
  target: NotationSelectionTarget | null,
): NotationInspectorSelection {
  const selectedEvent = target && score ? resolveSelectedEvent(score, target) : null;
  const noteIndex = resolveNoteIndex(selection, target);
  const eventNode: NoteEvent | null = selectedEvent?.type === "event" ? (selectedEvent as NoteEvent) : null;
  const selectedNote: Note | null = eventNode ? (eventNode.notes?.[noteIndex] ?? eventNode.notes?.[0] ?? null) : null;
  const selectedTie: Tie | null = selectedNote?.ties?.[target?.tieIndex ?? 0] ?? null;
  const selectedSlur: Slur | null = eventNode ? (eventNode.slurs?.[target?.slurIndex ?? 0] ?? null) : null;
  const selectedTrill = eventNode ? (eventNode.markings?.trill ?? null) : null;
  const selectedSequence = resolveSelectedSequence(score, target);
  const selectedContent = resolveSelectedContent(selectedSequence, target);

  return {
    selectedEvent,
    noteIndex,
    selectedNote,
    selectedTie,
    selectedSlur,
    selectedTrill,
    selectedSequence,
    selectedContent,
    isTuplet: selectedContent?.type === "tuplet",
    isEvent: selectedContent?.type === "event",
  };
}

export function useNotationInspectorSelection(
  selection: SelectionState,
  score: Score | null,
  target: NotationSelectionTarget | null,
): NotationInspectorSelection {
  return useMemo(() => buildSelection(selection, score, target), [selection, score, target]);
}
