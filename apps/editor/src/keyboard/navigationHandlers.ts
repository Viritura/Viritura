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
import { findNextAnnotation, findPrevAnnotation, isAnnotationId } from "../navigation/annotationNav";
import type { KeyboardHandlerContext } from "./types";

/** Alt+ArrowLeft/Right: cycle annotations without discarding harmony's source staff. */
export function handleAnnotationNavigation(direction: "next" | "previous", ctx: KeyboardHandlerContext): void {
  const selection = ctx.getSelection();
  if (selection.kind !== "single" || !isAnnotationId(selection.elementId)) return;
  const score = ctx.getScore();
  if (!score) return;
  const target =
    direction === "next"
      ? findNextAnnotation(score, selection.elementId)
      : findPrevAnnotation(score, selection.elementId);
  if (!target) return;

  // Copy suffixes identify rendered staves; only the existing anchor identifies
  // the mapped source in reordered/condensed layouts. Never derive one from a copy.
  if (/^m\d+\/chord\d+(?:\/p\d+\/staff\d+)?$/.test(target) && selection.measureAnchor) {
    ctx.selectElement(target, selection.measureAnchor);
  } else {
    ctx.selectElement(target);
  }
}

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
