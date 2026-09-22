import type { MouseEvent } from "react";
import type { Score } from "@viritura/core";
import type { DisplayList } from "@viritura/renderer";
import type { MeasureSelectionPoint } from "../../store/selectionStore";
import { chordRangeSourceStaff } from "../../score/chordSourceContext";
import { getRenderedStaffSources } from "./renderedStaffSources";
import { globalChordForElement } from "./chordFeedback";
import type { CanvasHandlerCtx } from "./canvasHandlers";

export function chordSelectionPoint(
  score: Score,
  point: MeasureSelectionPoint,
  selectedScoreIndex: number,
  displayList: DisplayList | null,
): MeasureSelectionPoint {
  return {
    ...point,
    sourceStaff: chordRangeSourceStaff(score, point, selectedScoreIndex, getRenderedStaffSources(displayList)) ?? null,
  };
}

export function selectCanvasElement(
  e: MouseEvent<HTMLCanvasElement>,
  ctx: CanvasHandlerCtx,
  elementId: string,
  measureAnchor?: MeasureSelectionPoint,
): void {
  const score = ctx.docScoreRef.current;
  if (measureAnchor && score && globalChordForElement(score, elementId)) {
    measureAnchor = chordSelectionPoint(score, measureAnchor, ctx.selectedScoreIndex, ctx.displayListRef.current);
  }
  if (e.shiftKey) ctx.extendSelection(elementId, measureAnchor);
  else if (e.ctrlKey || e.metaKey) ctx.toggleSelection(elementId);
  else if (measureAnchor) ctx.selectElement(elementId, measureAnchor);
  else ctx.selectElement(elementId);
}
