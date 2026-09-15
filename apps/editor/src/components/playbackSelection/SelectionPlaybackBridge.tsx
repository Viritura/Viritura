import { useEffect } from "react";
import { getPlaybackSnapshot } from "@viritura/playback";
import { useDocumentStoreApi } from "../../store/DocumentContext";
import { useSelectionStore } from "../../store/selectionStore";
import { computeSelectionStartTime } from "./selectionStartTime";

/** Selection changes choose the next start, never reposition a running transport. */
export function SelectionPlaybackBridge() {
  const documentStore = useDocumentStoreApi();
  useEffect(
    () =>
      useSelectionStore.subscribe(({ selection }, previous) => {
        if (selection === previous.selection) return;
        const { state, actions } = getPlaybackSnapshot();
        if (state.status === "playing" || state.status === "loading") return;
        const seconds = computeSelectionStartTime(selection, documentStore.getState().score, actions);
        if (seconds !== undefined) actions.seek(seconds);
      }),
    [documentStore],
  );
  return null;
}
