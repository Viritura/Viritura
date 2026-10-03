import type React from "react";
import type { DisplayList } from "@viritura/renderer";
import type { CanvasHandlerCtx } from "./canvasHandlers";
import { selectCanvasElement } from "./elementSelection";

const TEXT_FRAME_PREFIX = "text-frame/";

/**
 * Text frames paint above all notation, in `element_bboxes` order with later
 * frames on top. A click inside a painted frame therefore selects the topmost
 * frame there, ahead of the spatial index's smallest-box preference for music.
 */
export function topmostTextFrameAt(
  displayList: Pick<DisplayList, "elementBboxes"> | null | undefined,
  x: number,
  y: number,
): string | null {
  const entries = displayList?.elementBboxes ?? [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const { elementId, bbox } = entries[index]!;
    if (!elementId.startsWith(TEXT_FRAME_PREFIX)) continue;
    if (x >= bbox.x && x <= bbox.x + bbox.width && y >= bbox.y && y <= bbox.y + bbox.height) return elementId;
  }
  return null;
}

/** Engrave-mode click on a painted frame: select it into the shared selection. */
export function selectEngraveTextFrame(
  e: React.MouseEvent<HTMLCanvasElement>,
  ctx: CanvasHandlerCtx,
  dl: DisplayList | null,
  scoreX: number,
  scoreY: number,
): boolean {
  const frameHit = topmostTextFrameAt(dl, scoreX, scoreY);
  if (!frameHit) return false;
  if (ctx.selectedSlurIdRef.current) ctx.setSelectedSlurId(null);
  selectCanvasElement(e, ctx, frameHit);
  return true;
}
