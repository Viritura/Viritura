/**
 * Write-mode score context menu.
 *
 * Right-clicking retargets the selection when the pointer is over an element
 * that isn't already selected, so the menu always acts on what the user
 * pointed at, then opens the editing commands supplied by the host view.
 */

import type { MouseEvent } from "react";
import type { CanvasHandlerCtx } from "./canvasHandlers";
import { findNearbyElement, pointerToMeasure } from "./hitTesting";
import { screenToEngine } from "./engineCoordinates";

/** Strip a notehead suffix so a right-click resolves to its parent event. */
function toEventId(hitId: string, exact: boolean): string {
  if (exact || hitId.startsWith("slur/") || hitId.startsWith("tie/")) return hitId;
  return hitId.replace(/\/n\d+$/, "");
}

export function openWriteSelectionContextMenu(e: MouseEvent<HTMLCanvasElement>, ctx: CanvasHandlerCtx): void {
  const buildItems = ctx.buildSelectionMenuItemsRef.current;
  if (!buildItems) return;
  const canvas = ctx.canvasRef.current;
  const si = ctx.spatialIndexRef.current;
  if (!canvas || !si) return;

  let hasSelection = (ctx.selectedIds?.size ?? 0) > 0;
  const pt = screenToEngine(e, canvas, ctx.viewport, ctx.displayListRef.current, ctx.viewMode);
  if (pt) {
    const measureBounds = ctx.displayListRef.current?.measureBounds;
    const exactHit = si.hitTest(pt.scoreX, pt.scoreY);
    const hitId = exactHit ?? findNearbyElement(si, pt.scoreX, pt.scoreY, measureBounds);
    if (hitId) {
      const eventId = toEventId(hitId, exactHit === hitId);
      // Preserve an existing multi-element selection when the user right-clicks
      // inside it — that selection is usually the subject of the command.
      if (!ctx.selectedIds?.has(eventId)) {
        const measureAnchor = pointerToMeasure(pt.scoreX, pt.scoreY, measureBounds);
        ctx.selectElement(eventId, measureAnchor ?? undefined);
      }
      hasSelection = true;
    }
  }

  // The selection above lands in a React store that has not re-rendered yet, so
  // the menu is built against what the click targeted rather than stale state.
  const items = buildItems({ hasSelection });
  if (items.length === 0) return;
  e.preventDefault();
  ctx.setContextMenu({ x: e.clientX, y: e.clientY, items });
}
