import type React from "react";
import type { DisplayList } from "@viritura/renderer";
import type { CanvasHandlerCtx } from "./canvasHandlers";
import { pointerToMeasure } from "./hitTesting";
import { globalChordForElement, previewClickedChord } from "./chordFeedback";
import { resolveCanvasSelectionElementId, selectCanvasElement } from "./elementSelection";
import { isEngraveTextAnnotationId } from "../../score/ElementPath";

export function selectEngraveTextOrChord(
  e: React.MouseEvent<HTMLCanvasElement>,
  ctx: CanvasHandlerCtx,
  dl: DisplayList | null,
  hitId: string | null,
  scoreX: number,
  scoreY: number,
): boolean {
  if (!hitId || (!isEngraveTextAnnotationId(hitId) && !globalChordForElement(ctx.docScoreRef.current, hitId))) {
    return false;
  }
  const measureAnchor = pointerToMeasure(scoreX, scoreY, dl?.measureBounds) ?? undefined;
  selectCanvasElement(
    e,
    ctx,
    resolveCanvasSelectionElementId(ctx.docScoreRef.current, ctx.displayListRef.current, hitId, measureAnchor, scoreX),
    measureAnchor,
  );
  previewClickedChord(ctx.docScoreRef.current, hitId, ctx.previewChord);
  return true;
}
