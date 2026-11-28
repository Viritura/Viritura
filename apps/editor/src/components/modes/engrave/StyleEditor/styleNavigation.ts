import { useMemo } from "react";
import type { Score } from "@viritura/core";
import { toast } from "sonner";
import { useDocumentStoreApi } from "../../../../store/DocumentContext";
import { useViewStateStore } from "../../../../store/viewStateStore";
import type { StyleNavigation } from "./pageFieldView";
import { useStyleEditorStore } from "./styleEditorStore";

/** Score updates plus jumps between house profiles and layouts for the style editor. */
export function useStyleNavigation(): StyleNavigation {
  const store = useDocumentStoreApi();
  const openHouse = useStyleEditorStore((state) => state.openHouse);
  const openLayoutPanel = useStyleEditorStore((state) => state.openLayout);
  const setSelectedScoreIndex = useViewStateStore((state) => state.setSelectedScoreIndex);
  return useMemo(
    () => ({
      transform: (update: (score: Score) => Score, message?: string) => {
        const state = store.getState();
        const current = state.workingScore ?? state.score;
        if (!current) {
          toast.error("Open a score before changing its engraving style.");
          return;
        }
        const next = update(current);
        if (next === current) return;
        state.updateScore(next);
        if (message) toast.success(message);
      },
      openProfile: openHouse,
      openLayout: (index: number) => {
        setSelectedScoreIndex(index);
        openLayoutPanel();
      },
    }),
    [store, openHouse, openLayoutPanel, setSelectedScoreIndex],
  );
}
