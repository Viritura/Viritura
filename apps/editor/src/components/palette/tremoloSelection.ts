import type { Score } from "@viritura/core";
import type { EventLocation } from "../../score/ElementPath";
import { resolveEventFromSubElement, resolveEventLocation } from "../../score/ElementPath";
import type { SelectionState } from "../../store/selectionStore";
import { resolveSelectionEvents } from "../../store/selectionUtils";

function resolveEndpoint(elementId: string, score: Score): EventLocation | null {
  return resolveEventFromSubElement(elementId, score) ?? resolveEventLocation(elementId, score);
}

export function resolveTwoNoteTremoloSelection(selection: SelectionState, score: Score): EventLocation[] {
  if (selection.kind !== "range") return resolveSelectionEvents(selection, score);

  const start = resolveEndpoint(selection.startElementId, score);
  const end = resolveEndpoint(selection.endElementId, score);
  if (!start || !end) return [];
  if (
    start.partIndex === end.partIndex &&
    start.measureIndex === end.measureIndex &&
    start.sequenceIndex === end.sequenceIndex &&
    start.eventIndex === end.eventIndex &&
    start.tupletIndex === end.tupletIndex
  ) {
    return [start];
  }
  return [start, end];
}
