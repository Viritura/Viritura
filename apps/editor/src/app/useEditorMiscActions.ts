import { useCallback } from "react";
import { selectAllRange } from "../store/selectionUtils";
import { executeDeletion } from "../commands/deletion";
import { MIN_ZOOM, MAX_ZOOM } from "../viewport";
import type { useDocumentStoreApi } from "../store/DocumentContext";
import { useSelectionStore, type useSelection } from "../store/selectionStore";
import { toast } from "sonner";
import type { Score } from "@viritura/core";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { RefObject } from "react";
import { useViewStateStore } from "../store/viewStateStore";
import { swapStaffContents } from "../commands/staffSwap";

type SelectionState = ReturnType<typeof useSelection>;

interface UseEditorMiscActionsArgs {
  store: ReturnType<typeof useDocumentStoreApi>;
  selection: SelectionState;
  updateScore: (next: Score) => void;
  selectElement: (id: string) => void;
  selectRange: (start: string, end: string) => void;
  clearSelection: () => void;
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  currentZoom: number;
}

export interface EditorMiscActions {
  handleSelectAll: () => void;
  handleDeleteSelection: () => void;
  handleDeleteSelectedBars: () => void;
  handleSwapStaffContents: () => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleResetZoom: () => void;
  getSelectedMeasureIndex: () => number | null;
  getSelectedPartIndex: () => number | null;
}

export function useEditorMiscActions({
  store,
  selection,
  updateScore,
  selectElement,
  selectRange,
  clearSelection,
  canvasRef,
  currentZoom,
}: UseEditorMiscActionsArgs): EditorMiscActions {
  const handleSelectAll = useCallback(() => {
    const { score } = store.getState();
    if (!score) return;
    const range = selectAllRange(score);
    if (!range) return;
    selectRange(range.startElementId, range.endElementId);
  }, [store, selectRange]);

  const handleDeleteSelection = useCallback(() => {
    executeDeletion({
      getScore: () => store.getState().workingScore,
      getSelection: () => useSelectionStore.getState().selection,
      getScoreIndex: () => useViewStateStore.getState().selectedScoreIndex,
      updateScore,
      selectElement,
      clearSelection,
    });
  }, [store, updateScore, selectElement, clearSelection]);

  const handleDeleteSelectedBars = useCallback(() => {
    const { workingScore: score } = store.getState();
    const selected = useSelectionStore.getState().selection;
    if (!score || selected.kind !== "measure") {
      toast.info("Select bars to delete first.");
      return;
    }
    const deleted = executeDeletion(
      {
        getScore: () => score,
        getSelection: () => selected,
        getScoreIndex: () => useViewStateStore.getState().selectedScoreIndex,
        updateScore,
        selectElement,
        clearSelection,
      },
      "remove-bars",
    );
    if (!deleted) {
      toast.error("The selected bars are no longer available.");
    }
  }, [store, updateScore, selectElement, clearSelection]);

  const handleZoomIn = useCallback(() => {
    const z = Math.min(currentZoom * 1.25, MAX_ZOOM);
    canvasRef.current?.setZoom(z);
  }, [currentZoom, canvasRef]);

  const handleSwapStaffContents = useCallback(() => {
    const { score } = store.getState();
    const next = score && swapStaffContents(score, useSelectionStore.getState().selection);
    if (!next) {
      toast.info("Select bars on exactly two staves to swap their contents.");
      return;
    }
    updateScore(next);
  }, [store, updateScore]);

  const handleZoomOut = useCallback(() => {
    const z = Math.max(currentZoom / 1.25, MIN_ZOOM);
    canvasRef.current?.setZoom(z);
  }, [currentZoom, canvasRef]);

  const handleResetZoom = useCallback(() => {
    canvasRef.current?.resetViewport();
  }, [canvasRef]);

  const getSelectedMeasureIndex = useCallback((): number | null => {
    if (selection.kind !== "single" || !selection.elementId) return null;
    const match = selection.elementId.match(/(?:^|\/)m(\d+)(?:\/|$)/);
    if (!match) return null;
    const idx = Number.parseInt(match[1]!, 10);
    const { score } = store.getState();
    if (!score || idx < 0 || idx >= score.global.measures.length) return null;
    return idx;
  }, [selection, store]);

  const getSelectedPartIndex = useCallback((): number | null => {
    if (selection.kind !== "single" || !selection.elementId) return null;
    const match = selection.elementId.match(/(?:^|\/)p(\d+)(?:\/|$)/);
    if (!match) return null;
    return Number.parseInt(match[1]!, 10);
  }, [selection]);

  return {
    handleSelectAll,
    handleDeleteSelection,
    handleDeleteSelectedBars,
    handleSwapStaffContents,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    getSelectedMeasureIndex,
    getSelectedPartIndex,
  };
}
