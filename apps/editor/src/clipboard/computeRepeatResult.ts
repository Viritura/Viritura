import type { Score } from "@viritura/core";
import { applyPaste, type PasteResult } from "../commands/clipboardCommands";
import { assignFreshIds } from "./deserialize";
import type { ClipboardSelection } from "../commands/clipboardCommands";
import { findPastedSelection } from "./computePasteResult";

/**
 * Build a fresh `PasteResult` from a clipboard-style selection, then paste it
 * immediately after the current selection. Returns the updated score and the
 * pasted ID range, or `null` if the inputs aren't actionable.
 */
export function computeRepeatResult(
  score: Score,
  sel: ClipboardSelection,
): { newScore: Score; range: { start: string; end: string } | null } | null {
  const pasteResult: PasteResult = {
    content: assignFreshIds(sel.events),
    sourceTimeSignature: sel.timeSignature,
    sourceKeySignature: sel.keySignature,
    dynamics: sel.dynamics,
    tracks: sel.tracks?.map((t) => ({
      ...t,
      content: assignFreshIds(t.content),
    })),
  };

  const partIndex = sel.partIndex;
  const measureIndex = sel.measureIndex;
  const sequenceIndex = sel.sequenceIndex;
  let eventIndex = sel.eventIndex + sel.events.length;

  const seq = score.parts[partIndex]?.measures[measureIndex]?.sequences[sequenceIndex];
  if (seq && eventIndex > seq.content.length) {
    eventIndex = seq.content.length;
  }

  const newScore = applyPaste(score, pasteResult, partIndex, measureIndex, sequenceIndex, eventIndex);
  const range = findPastedSelection(newScore, pasteResult.content, partIndex, measureIndex, sequenceIndex);
  return { newScore, range };
}
