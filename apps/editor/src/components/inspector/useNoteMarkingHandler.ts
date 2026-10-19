import { patch, type Score, type ScorePatch, type SlideInType, type SlideOutType } from "@viritura/core";
import { useCallback } from "react";
import type { SelectionState } from "../../store/selectionStore";
import { useViewStateStore } from "../../store/viewStateStore";
import { planSelectionWriteback } from "../../score/condensedWriteback";
import { getEventAtLocation } from "../../score/ElementPath";

interface NoteMarkingHandlerArgs {
  score: Score | null;
  selection: SelectionState;
  commitPatches: (patches: readonly ScorePatch[]) => void;
}

export function useNoteMarkingHandler({ score, selection, commitPatches }: NoteMarkingHandlerArgs) {
  const selectedScoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const update = useCallback(
    (key: "slideIn" | "slideOut", type: SlideInType | SlideOutType | undefined) => {
      if (!score) return;
      const patches: ScorePatch[] = [];
      for (const target of planSelectionWriteback(score, selection, selectedScoreIndex).sourceNotes) {
        const event = getEventAtLocation(score, target);
        const note =
          event?.type === "event" && target.noteIndex !== undefined ? event.notes?.[target.noteIndex] : undefined;
        const partId = score.parts[target.partIndex]?.id;
        if (event?.type !== "event" || !event.id || !note?.id || !partId) continue;
        const current = note.markings?.[key];
        if (current?.type === type) continue;
        const value = type === undefined ? undefined : { ...current, type };
        const locator = {
          sequencePath: { partId, measureIndex: target.measureIndex, voice: target.sequenceIndex },
          eventId: event.id,
        };
        patches.push(patch.setNoteMarking(locator, note.id, key, value));
      }
      if (patches.length > 0) commitPatches(patches);
    },
    [score, selection, selectedScoreIndex, commitPatches],
  );

  const setSlideIn = useCallback((type: SlideInType | undefined) => update("slideIn", type), [update]);
  const setSlideOut = useCallback((type: SlideOutType | undefined) => update("slideOut", type), [update]);
  return { setSlideIn, setSlideOut };
}
