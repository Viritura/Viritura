/**
 * useSelectionPruner — clears the current selection when its target
 * element no longer resolves in the score (e.g. after an edit deleted
 * or restructured the underlying event).
 *
 * Without this, selection IDs become stale: subsequent operations
 * either silently no-op or operate on the wrong element. See
 * SelectionContext.tsx — IDs without "/" are filtered, but valid-shape
 * IDs that point at deleted events were previously kept.
 */

import { useEffect } from "react";
import type { Score } from "@viritura/core";
import { useDocumentStoreApi } from "./DocumentContext";
import { useSelection, useSelectionActions } from "./selectionStore";
import { resolveEventFromSubElement, resolveAnnotationLocation } from "../score/ElementPath";

/** True when the element ID still resolves against the current score. */
function isSelectionIdValid(elementId: string, score: Score): boolean {
  // Bare or empty IDs are already filtered by SelectionContext; leave them alone.
  if (!elementId.includes("/")) return true;

  // Event-shaped IDs (p{}/m{}/s{}/...) — verify the event still exists.
  if (/^p\d+\/m\d+\/s\d+\//.test(elementId)) {
    return resolveEventFromSubElement(elementId, score) != null;
  }

  // Annotation-style IDs (dynamics, tempo, etc.) — try the annotation resolver.
  if (resolveAnnotationLocation(elementId)) {
    // resolveAnnotationLocation only parses the ID; we trust the parse and
    // additionally require the addressed measure/part to exist.
    const partMatch = elementId.match(/^p(\d+)\/m(\d+)/);
    if (partMatch) {
      const partIndex = parseInt(partMatch[1]!, 10);
      const measureIndex = parseInt(partMatch[2]!, 10);
      return score.parts[partIndex]?.measures[measureIndex] != null;
    }
    const mOnly = elementId.match(/^m(\d+)/);
    if (mOnly) {
      const measureIndex = parseInt(mOnly[1]!, 10);
      return score.global.measures[measureIndex] != null;
    }
  }

  // Anything else: don't prune (safer than aggressive clearing).
  return true;
}

export function useSelectionPruner(): void {
  const store = useDocumentStoreApi();
  const selection = useSelection();
  const { clearSelection } = useSelectionActions();

  useEffect(() => {
    return store.subscribe((state, prev) => {
      if (state.score === prev.score) return;
      const score = state.score;
      if (!score) return;

      const ids: string[] =
        selection.kind === "single"
          ? [selection.elementId]
          : selection.kind === "range"
            ? [selection.startElementId, selection.endElementId]
            : selection.kind === "multi"
              ? [...selection.elementIds]
              : [];

      if (ids.length === 0) return;
      const allValid = ids.every((id) => isSelectionIdValid(id, score));
      if (!allValid) {
        console.debug("[Selection] Pruning stale selection after score change:", ids);
        clearSelection();
      }
    });
  }, [store, selection, clearSelection]);
}
