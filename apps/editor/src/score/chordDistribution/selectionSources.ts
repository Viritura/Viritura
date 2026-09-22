import type { Score } from "@viritura/core";
import type { EventLocation } from "../ElementPath";
import { resolveCondensedSelectionEvents } from "../condensedWriteback";
import type { Selection } from "../../store/selectionStore";

/**
 * Resolve the visual selection to the canonical events that supplied it.
 *
 * Canvas selections on a condensed staff name one event in the rendered
 * projection. The other source events represented by that projection must be
 * included before distribution derives its staves and rhythmic window.
 */
export function distributionSourceEvents(
  score: Score,
  selection: Selection,
  selectedScoreIndex: number,
): EventLocation[] {
  return resolveCondensedSelectionEvents(score, selection, selectedScoreIndex);
}
