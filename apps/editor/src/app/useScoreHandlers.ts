import { useCallback } from "react";
import { useScoreCreation, type ScoreCreationActions } from "./useScoreCreation";
import { useScoreEditingActions } from "./useScoreEditingActions";
import { useScoreListActions, type ScoreListActions } from "./useScoreListActions";
import { useExportActions } from "./useExportActions";
import type { LayoutDefinition, Score } from "@viritura/core";
import type { DocumentStore } from "../store/documentStore";
import type { SelectionState } from "../store/selectionStore";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { RefObject } from "react";

type ScoreEditingActions = ReturnType<typeof useScoreEditingActions>;
type ExportActions = ReturnType<typeof useExportActions>;

interface UseScoreHandlersParams {
  store: DocumentStore;
  loadScore: (score: Score, fileName?: string, mnxJson?: string) => void;
  resetHistory: (mnxJson: string) => void;
  selection: SelectionState;
  selectedScoreIndex: number;
  setSelectedScoreIndex: React.Dispatch<React.SetStateAction<number>>;
  setFileHandle: React.Dispatch<React.SetStateAction<FileSystemFileHandle | null>>;
  setExpandedCondensingStaves: React.Dispatch<React.SetStateAction<Set<string>>>;
  pageSetupTargetIndex: number | null;
  updateScore: (next: Score) => void;
  canCreateGitHubRepository: boolean;
  canvasRef: RefObject<ScoreCanvasHandle | null>;
  /** Navigate to Setup mode once a new score exists. */
  onOpenSetup?: (() => void) | undefined;
}

export interface ScoreHandlers extends ScoreCreationActions, ScoreEditingActions, ScoreListActions, ExportActions {
  handleLayoutChange: (layouts: LayoutDefinition[]) => void;
}

/**
 * Bundles score creation, editing, list, and export hooks plus the
 * inline handleLayoutChange callback into one orchestrator returning
 * a flat bag of score-level handlers.
 */
export function useScoreHandlers(params: UseScoreHandlersParams): ScoreHandlers {
  const {
    store,
    loadScore,
    resetHistory,
    selection,
    selectedScoreIndex,
    setSelectedScoreIndex,
    setFileHandle,
    setExpandedCondensingStaves,
    pageSetupTargetIndex,
    updateScore,
    canCreateGitHubRepository,
    canvasRef,
    onOpenSetup,
  } = params;

  const creation = useScoreCreation({
    store,
    loadScore,
    resetHistory,
    setSelectedScoreIndex,
    setFileHandle,
    canCreateGitHubRepository,
    onOpenSetup,
  });

  const editing = useScoreEditingActions({
    store,
    selection,
    selectedScoreIndex,
    pageSetupTargetIndex,
    updateScore,
  });

  const list = useScoreListActions({
    store,
    updateScore,
    selectedScoreIndex,
    setSelectedScoreIndex,
    setExpandedCondensingStaves,
  });

  const exports = useExportActions({ canvasRef, store });

  const handleLayoutChange = useCallback(
    (layouts: LayoutDefinition[]) => {
      const { score } = store.getState();
      if (!score) return;
      updateScore({ ...score, layouts });
    },
    [store, updateScore],
  );

  return { ...creation, ...editing, ...list, ...exports, handleLayoutChange };
}
