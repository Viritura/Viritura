import { useCallback } from "react";
import { selectAllRange } from "../store/selectionUtils";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";
import { MIN_ZOOM, MAX_ZOOM } from "../viewport";
import type { useDocumentStoreApi } from "../store/DocumentContext";
import type { useSelection } from "../store/selectionStore";
import type { Score } from "@viritura/core";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { RefObject } from "react";

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
    const result = computeDeleteSelection(store.getState().score, selection);
    if (result.kind === "noop") return;
    updateScore(result.score);
    if (result.kind === "single") {
      if (result.nextSelection.kind === "select") {
        selectElement(result.nextSelection.elementId);
      } else {
        clearSelection();
      }
    } else if (result.kind === "multi") {
      clearSelection();
    }
  }, [store, selection, updateScore, selectElement, clearSelection]);

  const handleZoomIn = useCallback(() => {
    const z = Math.min(currentZoom * 1.25, MAX_ZOOM);
    canvasRef.current?.setZoom(z);
  }, [currentZoom, canvasRef]);

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
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
    getSelectedMeasureIndex,
    getSelectedPartIndex,
  };
}
