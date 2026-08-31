import { produce } from "../score/scoreClone";
import { resolveEventLocation } from "../score/ElementPath";
import { beatsToDuration, durationToBeats } from "../commands/noteCommands";
import { createTuplet, createTupletFromEvent, getTupletOuterMultiple } from "../commands/tupletCommands";
import { measureBeats } from "@viritura/core";
import type { Score, TimeSignature } from "@viritura/core";
import type { NoteInputState } from "../store/noteInputStore";
import type { SelectionState } from "../store/selectionStore";

export interface ApplyTupletInput {
  score: Score;
  noteInputState: NoteInputState;
  selection: SelectionState;
  tupletNumber: number;
  customOuter?: number;
}

export function applyTupletFromRadialMenu({
  score,
  noteInputState,
  selection,
  tupletNumber,
  customOuter,
}: ApplyTupletInput): Score {
  return produce(score, (draft) => {
    if (noteInputState.active) {
      const cursor = noteInputState.cursorPosition;
      if (!cursor) return;
      const partIndex = cursor.partIndex;
      const voice = noteInputState.currentVoice - 1;
      const selectedDuration = {
        base: noteInputState.currentDuration,
        ...(noteInputState.dotCount > 0 ? { dots: noteInputState.dotCount } : {}),
      };
      const outerMul = customOuter ?? getTupletOuterMultiple(tupletNumber);
      const selectedBeats = durationToBeats(selectedDuration);
      const baseDuration = beatsToDuration(selectedBeats / outerMul);
      if (!baseDuration) return;

      const measureIdx = cursor.measureIndex;
      let activeTime: TimeSignature = { count: 4, unit: 4 };
      for (let m = 0; m <= measureIdx; m++) {
        const gm = draft.global.measures[m];
        if (gm?.time) activeTime = gm.time;
      }
      const maxBeats = measureBeats(activeTime);
      if (cursor.beatPosition + selectedBeats > maxBeats + 1e-9) return;

      try {
        createTuplet(draft, {
          measureIndex: measureIdx,
          partIndex,
          voice,
          beatPosition: cursor.beatPosition,
          tupletNumber,
          outerMultiple: outerMul,
          baseDuration,
        });
      } catch {
        /* invalid tuplet */
      }
    } else {
      if (selection.kind === "single") {
        const loc = resolveEventLocation(selection.elementId, draft);
        if (loc && loc.tupletIndex === undefined) {
          try {
            createTupletFromEvent(draft, {
              measureIndex: loc.measureIndex,
              partIndex: loc.partIndex,
              voice: loc.sequenceIndex,
              eventIndex: loc.eventIndex,
              tupletNumber,
              outerMultiple: customOuter ?? getTupletOuterMultiple(tupletNumber),
            });
          } catch {
            /* invalid tuplet */
          }
        }
      }
    }
  });
}
