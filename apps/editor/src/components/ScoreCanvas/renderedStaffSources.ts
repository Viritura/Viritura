import { useCallback, useEffect } from "react";
import type { Score } from "@viritura/core";
import type { DisplayList } from "@viritura/renderer";
import { useSelectionStore, type RenderedStaffSources } from "../../store/selectionStore";

// Associate projection identities with the result, not the request: stale worker
// results must never replace the identities of the display list actually in use.
const projectedSources = new WeakMap<DisplayList, RenderedStaffSources>();

export function recordRenderedStaffSources(displayList: DisplayList, score: Score | null): DisplayList {
  if (!score || !displayList.measureBounds?.length) {
    projectedSources.delete(displayList);
    return displayList;
  }
  // Authored layout nodes are not visual staves: the engine may split sources
  // with incompatible meters, or retain silent sources in a condensed staff.
  projectedSources.set(
    displayList,
    displayList.measureBounds.map((bound) => ({
      staffIndex: bound.staffIndex,
      measureIndex: bound.index,
      partIds: [
        ...new Set(
          (bound.sourcePartIndices ?? [bound.partIndex]).flatMap((index) => {
            const id = score.parts[index]?.id;
            return id ? [id] : [];
          }),
        ),
      ],
    })),
  );
  return displayList;
}

export function getRenderedStaffSources(displayList: DisplayList | null): RenderedStaffSources {
  return displayList ? projectedSources.get(displayList) : undefined;
}

export function useRenderedStaffSources(
  displayListRef: { current: DisplayList | null },
  displayListVersion: number,
  printPreview: boolean,
): () => void {
  const getter = useCallback(
    () =>
      displayListRef.current
        ? getRenderedStaffSources(displayListRef.current)
        : useSelectionStore.getState().renderedStaffSources,
    [displayListRef],
  );
  const publish = useCallback(() => {
    const store = useSelectionStore.getState();
    const sources = getter();
    if (
      store.renderedStaffSourcesGetter !== getter ||
      !displayListRef.current ||
      store.renderedStaffSources === sources
    ) {
      return;
    }
    useSelectionStore.setState({ renderedStaffSources: sources });
  }, [displayListRef, getter]);

  useEffect(() => {
    if (printPreview) return;
    useSelectionStore.setState({ renderedStaffSourcesGetter: getter });
    return () => {
      if (useSelectionStore.getState().renderedStaffSourcesGetter === getter) {
        // Keep the committed identity snapshot while the canvas is absent.
        // Reinterpreting expanded indices against the base layout changes parts.
        useSelectionStore.setState({ renderedStaffSourcesGetter: null });
      }
    };
  }, [getter, printPreview]);

  useEffect(() => publish(), [displayListVersion, publish]);
  return publish;
}
