import {
  patch,
  type Note,
  type NoteEvent,
  type ScorePatch,
  type SequenceContent,
  type SlideInType,
  type SlideOutType,
} from "@viritura/core";
import { useCallback } from "react";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";

interface NoteMarkingHandlerArgs {
  note: Note | null;
  event: SequenceContent | null;
  target: NotationSelectionTarget | null;
  partId: string | undefined;
  commitPatches: (patches: readonly ScorePatch[]) => void;
}

export function useNoteMarkingHandler({ note, event, target, partId, commitPatches }: NoteMarkingHandlerArgs) {
  const update = useCallback(
    (key: "slideIn" | "slideOut", type: SlideInType | SlideOutType | undefined) => {
      if (
        !note?.id ||
        event?.type !== "event" ||
        !(event as NoteEvent).id ||
        !target ||
        target.sequenceIndex === undefined ||
        target.noteIndex === undefined ||
        !partId
      ) {
        return;
      }
      const current = note.markings?.[key];
      const value = type === undefined ? undefined : { ...current, type };
      if (current?.type === value?.type) return;
      const locator = {
        sequencePath: { partId, measureIndex: target.measureIndex, voice: target.sequenceIndex },
        eventId: (event as NoteEvent).id!,
      };
      commitPatches([patch.setNoteMarking(locator, note.id, key, value)]);
    },
    [note, event, target, partId, commitPatches],
  );

  const setSlideIn = useCallback((type: SlideInType | undefined) => update("slideIn", type), [update]);
  const setSlideOut = useCallback((type: SlideOutType | undefined) => update("slideOut", type), [update]);
  return { setSlideIn, setSlideOut };
}
