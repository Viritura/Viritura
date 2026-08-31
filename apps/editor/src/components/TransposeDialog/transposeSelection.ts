import type { Score } from "@viritura/core";
import type { SelectionState } from "../../store/selectionStore";
import { resolveSelectionEvents } from "../../store/selectionUtils";
import { getEventAtLocation } from "../../score/ElementPath";

export interface TransposeSelectionInfo {
  readonly eventCount: number;
  readonly noteCount: number;
  readonly description: string;
}

export function getTransposeSelectionInfo(score: Score | null, selection: SelectionState): TransposeSelectionInfo {
  if (!score) return { eventCount: 0, noteCount: 0, description: "No pitched notes selected" };

  const locations = resolveSelectionEvents(selection, score);
  let eventCount = 0;
  let noteCount = 0;
  for (const location of locations) {
    const event = getEventAtLocation(score, location);
    if (event?.type !== "event" || !event.notes?.length) continue;
    eventCount++;
    noteCount += location.noteIndex === undefined ? event.notes.length : 1;
  }

  if (noteCount === 0) return { eventCount: 0, noteCount: 0, description: "No pitched notes selected" };
  const noteLabel = `${noteCount} selected ${noteCount === 1 ? "note" : "notes"}`;
  const description = eventCount > 1 ? `${noteLabel} across ${eventCount} events` : noteLabel;
  return { eventCount, noteCount, description };
}
