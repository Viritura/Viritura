import type { Score } from "@viritura/core";
import type { MeasureSelectionPoint, SelectionState } from "../../store/selectionStore";
import { resolveSelectionMeasureRange } from "../../store/selectionUtils";
import { computeDeleteSelection } from "./selection";
import { removeMeasureRangeFromScore } from "./structuralTargets";

interface DeletionContext {
  getScore: () => Score | null;
  getSelection: () => SelectionState;
  getScoreIndex: () => number;
  updateScore: (score: Score) => void;
  selectElement: (id: string, measureAnchor?: MeasureSelectionPoint) => void;
  clearSelection: () => void;
}

export function executeDeletion(context: DeletionContext, intent: "selection" | "remove-bars" = "selection"): boolean {
  const score = context.getScore();
  const selection = context.getSelection();
  if (!score) return false;
  if (intent === "remove-bars") {
    const range =
      selection.kind === "measure"
        ? {
            startMeasure: Math.min(selection.startMeasure, selection.endMeasure),
            endMeasure: Math.max(selection.startMeasure, selection.endMeasure),
          }
        : selection.kind === "range"
          ? resolveSelectionMeasureRange(
              selection.startElementId,
              selection.endElementId,
              score,
              selection.measureAnchor,
              selection.measureFocus,
            )
          : null;
    if (!range) return false;
    const next = removeMeasureRangeFromScore(score, range.startMeasure, range.endMeasure, true);
    if (!next) return false;
    if (JSON.stringify(next) !== JSON.stringify(score)) context.updateScore(next);
    context.clearSelection();
    return true;
  }
  const result = computeDeleteSelection(score, selection, context.getScoreIndex());
  if (result.kind === "noop") return false;
  context.updateScore(result.score);
  if (result.kind === "measure") return true;
  if (result.nextSelection.kind === "select") {
    context.selectElement(
      result.nextSelection.elementId,
      selection.kind === "single" ? selection.measureAnchor : undefined,
    );
  } else context.clearSelection();
  return true;
}
