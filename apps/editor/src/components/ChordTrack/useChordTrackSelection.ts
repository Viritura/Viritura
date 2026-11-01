import { useEffect } from "react";
import { compareChordSymbolPositions } from "@viritura/core";
import type { DocumentStore } from "../../store/documentStore";
import { useSelectionActions, useSelectionStore } from "../../store/selectionStore";

export function useChordTrackSelection(store: DocumentStore): void {
  const { selectElement, clearSelection } = useSelectionActions();
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (state.workingScore === previous.workingScore && state.documentGeneration === previous.documentGeneration)
          return;
        const selection = useSelectionStore.getState().selection;
        if (selection.kind !== "single") return;
        const anchor = selection.measureAnchor;
        if (!anchor?.chordTrack || !anchor.chordPosition) return;
        if (!state.workingScore || state.documentGeneration !== previous.documentGeneration) {
          clearSelection();
          return;
        }
        const position = anchor.chordPosition;
        const index = state.workingScore.global.measures[anchor.measureIndex]?.chordSymbols?.findIndex(
          (chord) => compareChordSymbolPositions(chord.position, position) === 0,
        );
        if (index === undefined || index < 0) clearSelection();
        else {
          const id = `m${anchor.measureIndex}/chord${index}`;
          if (id !== selection.elementId) selectElement(id, anchor);
        }
      }),
    [store, selectElement, clearSelection],
  );
}
