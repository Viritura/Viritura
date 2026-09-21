import { useEffect } from "react";
import { getPlaybackSnapshot, usePlaybackActions } from "@viritura/playback";
import { useDocumentStoreApi } from "../../store/DocumentContext";
import { useSelectionStore } from "../../store/selectionStore";
import { useViewStateStore } from "../../store/viewStateStore";
import { computeSelectionPartIds } from "./selectionPartIds";
import { computeSelectionStartTime } from "./selectionStartTime";

/** Whole-measure selections filter parts; live selection changes also seek the transport. */
export function SelectionPlaybackBridge() {
  const documentStore = useDocumentStoreApi();
  const { setSelectionPartIds, setSelectionStaffCount } = usePlaybackActions();
  useEffect(() => {
    const updatePartFilter = () => {
      const { selection, renderedStaffSourcesGetter, renderedStaffSources } = useSelectionStore.getState();
      const partIds = computeSelectionPartIds(
        selection,
        documentStore.getState().score,
        useViewStateStore.getState().selectedScoreIndex,
        useViewStateStore.getState().selectedPartIds,
        renderedStaffSourcesGetter ? renderedStaffSourcesGetter() : renderedStaffSources,
      );
      setSelectionPartIds(partIds);
      setSelectionStaffCount(partIds === null ? null : selectionStaffCount(selection));
    };
    updatePartFilter();
    const unsubscribeSelection = useSelectionStore.subscribe((current, previous) => {
      const { selection, renderedStaffSources } = current;
      if (renderedStaffSources !== previous.renderedStaffSources) {
        updatePartFilter();
      }
      if (selection === previous.selection) return;
      updatePartFilter();
      const { state, actions } = getPlaybackSnapshot();
      if (state.status === "loading") return;
      const seconds = computeSelectionStartTime(selection, documentStore.getState().score, actions);
      if (seconds !== undefined) actions.seek(seconds);
    });
    const unsubscribeDocument = documentStore.subscribe(({ score }, previous) => {
      if (score !== previous.score) updatePartFilter();
    });
    const unsubscribeView = useViewStateStore.subscribe(({ selectedScoreIndex, selectedPartIds }, previous) => {
      if (selectedScoreIndex !== previous.selectedScoreIndex || selectedPartIds !== previous.selectedPartIds) {
        updatePartFilter();
      }
    });
    return () => {
      unsubscribeSelection();
      unsubscribeDocument();
      unsubscribeView();
      setSelectionPartIds(null);
      setSelectionStaffCount(null);
    };
  }, [documentStore, setSelectionPartIds, setSelectionStaffCount]);
  return null;
}

function selectionStaffCount(selection: ReturnType<typeof useSelectionStore.getState>["selection"]): number {
  if (selection.kind !== "measure") return 0;
  return Math.abs(selection.endStaffIndex - selection.startStaffIndex) + 1;
}
