/**
 * Write-mode score context menu.
 *
 * Right-clicking retargets the selection when the pointer is over an element
 * that isn't already selected, so the menu always acts on what the user
 * pointed at, then opens the editing commands supplied by the host view.
 */

import type { MouseEvent } from "react";
import type { CanvasHandlerCtx } from "./canvasHandlers";
import { findNearbyElement, pointerToMeasure, pointerToMeasureStaff } from "./hitTesting";
import { screenToEngine } from "./engineCoordinates";
import { useSelectionStore } from "../../store/selectionStore";

/** Strip a notehead suffix so a right-click resolves to its parent event. */
function toEventId(hitId: string, exact: boolean): string {
  if (exact || hitId.startsWith("slur/") || hitId.startsWith("tie/")) return hitId;
  return hitId.replace(/\/n\d+$/, "");
}

type SelectionContextMenuCtx = Pick<
  CanvasHandlerCtx,
  | "buildSelectionMenuItemsRef"
  | "canvasRef"
  | "spatialIndexRef"
  | "selectedIds"
  | "viewport"
  | "displayListRef"
  | "viewMode"
  | "selectElement"
  | "selectMeasure"
  | "setContextMenu"
>;

export function openWriteSelectionContextMenu(e: MouseEvent<HTMLCanvasElement>, ctx: SelectionContextMenuCtx): void {
  const buildItems = ctx.buildSelectionMenuItemsRef.current;
  if (!buildItems) return;
  const canvas = ctx.canvasRef.current;
  const si = ctx.spatialIndexRef.current;
  if (!canvas || !si) return;

  let hasSelection = (ctx.selectedIds?.size ?? 0) > 0;
  const pt = screenToEngine(e, canvas, ctx.viewport, ctx.displayListRef.current, ctx.viewMode);
  if (pt) {
    const measureBounds = ctx.displayListRef.current?.measureBounds;
    const measureAnchor = pointerToMeasure(pt.scoreX, pt.scoreY, measureBounds);
    const selection = useSelectionStore.getState().selection;
    const insideSelectedBars =
      selection.kind === "measure" &&
      measureAnchor !== null &&
      measureAnchor.measureIndex >= Math.min(selection.startMeasure, selection.endMeasure) &&
      measureAnchor.measureIndex <= Math.max(selection.startMeasure, selection.endMeasure) &&
      measureAnchor.partIndex >= Math.min(selection.startPartIndex, selection.endPartIndex) &&
      measureAnchor.partIndex <= Math.max(selection.startPartIndex, selection.endPartIndex) &&
      measureAnchor.staffIndex >= Math.min(selection.startStaffIndex, selection.endStaffIndex) &&
      measureAnchor.staffIndex <= Math.max(selection.startStaffIndex, selection.endStaffIndex);
    const exactHit = si.hitTest(pt.scoreX, pt.scoreY);
    const hitId = exactHit ?? findNearbyElement(si, pt.scoreX, pt.scoreY, measureBounds);
    if (insideSelectedBars) {
      hasSelection = true;
    } else if (hitId) {
      const eventId = toEventId(hitId, exactHit === hitId);
      // Preserve an existing multi-element selection when the user right-clicks
      // inside it — that selection is usually the subject of the command.
      if (!ctx.selectedIds?.has(eventId)) {
        ctx.selectElement(eventId, measureAnchor ?? undefined);
      }
      hasSelection = true;
    } else if (selection.kind === "none" || selection.kind === "measure") {
      const staff = pointerToMeasureStaff(pt.scoreX, pt.scoreY, measureBounds);
      if (staff) {
        ctx.selectMeasure(staff.partIndex, staff.staffIndex, staff.measureIndex, staff.localStaffIndex);
        hasSelection = true;
      }
    } else {
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
