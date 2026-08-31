/**
 * Navigation keyboard handlers.
 *
 * Handles: ArrowLeft/Right, ArrowUp/Down, Home/End, Tab/Shift+Tab, F/H/J cursor travel.
 */

import {
  findNextInVoice,
  findPrevInVoice,
  findNextMeasure,
  findPrevMeasure,
  findFirst,
  findLast,
} from "../navigation/NavigationIndex";
import { getEventAncestorId } from "../score/ElementPath";
import type { KeyboardHandlerContext } from "./types";

/** ArrowLeft/Right: navigate between elements. */
export function handleArrowLeftRight(e: KeyboardEvent, mod: boolean, ctx: KeyboardHandlerContext): void {
  const ni = ctx.getNavIndex();
  if (!ni) return;

  const sel = ctx.getSelection();
  const currentId =
    sel.kind === "single"
      ? sel.elementId
      : sel.kind === "range"
        ? sel.endElementId
        : sel.kind === "multi"
          ? sel.elementIds[sel.elementIds.length - 1]
          : undefined;

  e.preventDefault();

  if (!currentId) {
    const edge = e.key === "ArrowLeft" ? findLast(ni) : findFirst(ni);
    if (edge) ctx.selectElement(edge);
    return;
  }

  const navigationId = getEventAncestorId(currentId);
  const target = mod
    ? e.key === "ArrowLeft"
      ? findPrevMeasure(ni, navigationId)
      : findNextMeasure(ni, navigationId)
    : e.key === "ArrowLeft"
      ? findPrevInVoice(ni, navigationId)
      : findNextInVoice(ni, navigationId);

  if (target) {
    if (e.shiftKey) {
      ctx.extendSelection(target);
    } else {
      ctx.selectElement(target);
    }
  }
}

/** Home / End: jump to first or last element. */
export function handleHomeEnd(e: KeyboardEvent, ctx: KeyboardHandlerContext): void {
  const ni = ctx.getNavIndex();
  if (!ni) return;
  e.preventDefault();

  const sel = ctx.getSelection();
  const currentId =
    sel.kind === "single"
      ? sel.elementId
      : sel.kind === "range"
        ? sel.endElementId
        : sel.kind === "multi"
          ? sel.elementIds[sel.elementIds.length - 1]
          : undefined;

  const target = e.key === "Home" ? findFirst(ni) : findLast(ni);
  if (target) {
    if (e.shiftKey && currentId) {
      ctx.extendSelection(target);
    } else {
      ctx.selectElement(target);
    }
  }
}
