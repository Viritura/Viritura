import { useEffect, useRef } from "react";
import { resolveEventLocation } from "../score/ElementPath";
import { sequenceContentBeats } from "../commands/noteCommands";
import { computeEndOfContentCursor } from "../commands/cursorCommands";
import { measureIndexFromElementId, partIndexFromElementId } from "../commands/signatureCommands";
import type { useDocumentStoreApi } from "../store/DocumentContext";
import type { SelectionState } from "../store/selectionStore";
import type { CursorPosition, useNoteInput } from "../store/noteInputStore";
import type { Score } from "@viritura/core";

type NoteInputState = ReturnType<typeof useNoteInput>["state"];
type SetCursor = ReturnType<typeof useNoteInput>["setCursor"];

interface UseCursorOnNoteInputArgs {
  store: ReturnType<typeof useDocumentStoreApi>;
  noteInputState: NoteInputState;
  selection: SelectionState;
  setCursor: SetCursor;
}

function cursorAtEvent(elementId: string, score: Score): CursorPosition | null {
  const loc = resolveEventLocation(elementId, score);
  if (!loc) return null;
  const seq = score.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex];
  if (!seq) return null;
  let beatPosition = 0;
  for (let index = 0; index < loc.eventIndex && index < seq.content.length; index++) {
    beatPosition += sequenceContentBeats(seq.content[index]!);
  }
  return {
    measureIndex: loc.measureIndex,
    beatPosition,
    partIndex: loc.partIndex,
    staffIndex: Math.max(0, (seq.staff ?? 1) - 1),
  };
}

function cursorForSelection(selection: SelectionState, score: Score): CursorPosition | null {
  if (selection.kind === "single") {
    const eventCursor = cursorAtEvent(selection.elementId, score);
    if (eventCursor) return eventCursor;
    const measureIndex = measureIndexFromElementId(selection.elementId, score);
    if (measureIndex === null) return null;
    return {
      measureIndex,
      beatPosition: 0,
      partIndex: selection.measureAnchor?.partIndex ?? partIndexFromElementId(selection.elementId, score) ?? 0,
      staffIndex: selection.measureAnchor?.localStaffIndex ?? 0,
    };
  }
  if (selection.kind === "measure") {
    return {
      measureIndex: selection.startMeasure,
      beatPosition: 0,
      partIndex: selection.startPartIndex,
      staffIndex: selection.startLocalStaffIndex ?? 0,
    };
  }
  if (selection.kind === "range") return cursorAtEvent(selection.startElementId, score);
  if (selection.kind === "multi" && selection.elementIds[0]) return cursorAtEvent(selection.elementIds[0], score);
  return null;
}

export function useCursorOnNoteInputActivate({
  store,
  noteInputState,
  selection,
  setCursor,
}: UseCursorOnNoteInputArgs): void {
  const prevActiveRef = useRef(noteInputState.active);
  useEffect(() => {
    if (noteInputState.active && !prevActiveRef.current) {
      const { score } = store.getState();
      if (!score) {
        prevActiveRef.current = noteInputState.active;
        return;
      }
      const voice = noteInputState.currentVoice - 1;

      const selectionCursor = cursorForSelection(selection, score);
      if (selectionCursor) {
        setCursor(selectionCursor);
        prevActiveRef.current = noteInputState.active;
        return;
      }

      // Fallback: cursor at end of content in part 0
      const cursor = computeEndOfContentCursor(score, 0, voice);
      setCursor(cursor);
    }
    prevActiveRef.current = noteInputState.active;
  }, [noteInputState.active, noteInputState.currentVoice, store, selection, setCursor]);
}
