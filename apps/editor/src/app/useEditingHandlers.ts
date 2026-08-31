import { useClipboardActions, type ClipboardActions } from "./useClipboardActions";
import { useSignatureActions, type SignatureActions } from "./useSignatureActions";
import { useEditorMiscActions, type EditorMiscActions } from "./useEditorMiscActions";
import type { useDocumentStoreApi } from "../store/DocumentContext";
import type { useSelection } from "../store/selectionStore";
import type { Score } from "@viritura/core";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { RefObject } from "react";
import type { useHistoryStoreInstance } from "../store/historyStore";

type SelectionState = ReturnType<typeof useSelection>;

interface UseEditingHandlersParams {
  store: ReturnType<typeof useDocumentStoreApi>;
  historyStore: ReturnType<typeof useHistoryStoreInstance>;
  selection: SelectionState;
  updateScore: (next: Score) => void;
  selectElement: (id: string) => void;
  selectRange: (start: string, end: string) => void;
  clearSelection: () => void;
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  currentZoom: number;
}

export interface EditingHandlers extends ClipboardActions, SignatureActions, EditorMiscActions {}

/**
 * Bundles clipboard, signature, and editor misc actions into a single
 * orchestrator hook that returns a flat bag of editing handlers.
 */
export function useEditingHandlers(params: UseEditingHandlersParams): EditingHandlers {
  const {
    store,
    historyStore,
    selection,
    updateScore,
    selectElement,
    selectRange,
    clearSelection,
    canvasRef,
    currentZoom,
  } = params;

  const clipboard = useClipboardActions({
    store,
    historyStore,
    selection,
    updateScore,
    selectRange,
    selectElement,
  });

  const signature = useSignatureActions({ store, selection, updateScore });

  const misc = useEditorMiscActions({
    store,
    selection,
    updateScore,
    selectElement,
    selectRange,
    clearSelection,
    canvasRef,
    currentZoom,
  });

  return { ...clipboard, ...signature, ...misc };
}
