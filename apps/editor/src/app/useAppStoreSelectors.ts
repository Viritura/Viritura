import { useShallow } from "zustand/react/shallow";
import { useDocumentStore, useDocumentStoreApi } from "../store/DocumentContext";
import type { DocumentStoreState } from "../store/documentStore";
import { useHistoryStore, useHistoryStoreInstance } from "../store/historyStore";
import type { HistoryStoreState } from "../store/historyStore";
import { useSelection, useSelectionActions } from "../store/selectionStore";
import { useNoteInput } from "../store/noteInputStore";

type DocumentStoreApi = ReturnType<typeof useDocumentStoreApi>;

export interface AppStoreSelectors {
  store: DocumentStoreApi;
  loadScore: DocumentStoreState["loadScore"];
  updateScore: DocumentStoreState["updateScore"];
  commitPatches: DocumentStoreState["commitPatches"];
  repairMeasures: DocumentStoreState["repairMeasures"];
  dismissBeatCountWarnings: DocumentStoreState["dismissBeatCountWarnings"];
  dirty: DocumentStoreState["dirty"];
  fileName: DocumentStoreState["fileName"];
  beatCountIssues: DocumentStoreState["beatCountIssues"];
  selection: ReturnType<typeof useSelection>;
  clearSelection: ReturnType<typeof useSelectionActions>["clearSelection"];
  selectRange: ReturnType<typeof useSelectionActions>["selectRange"];
  selectElement: ReturnType<typeof useSelectionActions>["selectElement"];
  pushState: HistoryStoreState["pushState"];
  undo: HistoryStoreState["undo"];
  redo: HistoryStoreState["redo"];
  canUndo: HistoryStoreState["canUndo"];
  canRedo: HistoryStoreState["canRedo"];
  resetHistory: HistoryStoreState["reset"];
  historyStore: ReturnType<typeof useHistoryStoreInstance>;
  noteInputState: ReturnType<typeof useNoteInput>["state"];
  setCursor: ReturnType<typeof useNoteInput>["setCursor"];
  setCondensingRouting: ReturnType<typeof useNoteInput>["setCondensingRouting"];
}

/**
 * Bundles the ~20 store-selector calls at the top of AppInner into one
 * hook returning a flat bag. Uses a single shallow-selected slice for
 * the document and history stores to keep re-render behaviour identical
 * to the previous per-selector subscriptions.
 */
export function useAppStoreSelectors(): AppStoreSelectors {
  const store = useDocumentStoreApi();
  const doc = useDocumentStore(
    useShallow((s) => ({
      loadScore: s.loadScore,
      updateScore: s.updateScore,
      commitPatches: s.commitPatches,
      repairMeasures: s.repairMeasures,
      dismissBeatCountWarnings: s.dismissBeatCountWarnings,
      dirty: s.dirty,
      fileName: s.fileName,
      beatCountIssues: s.beatCountIssues,
    })),
  );
  const selection = useSelection();
  const { clearSelection, selectRange, selectElement } = useSelectionActions();
  const historyStore = useHistoryStoreInstance();
  const hist = useHistoryStore(
    useShallow((s) => ({
      pushState: s.pushState,
      undo: s.undo,
      redo: s.redo,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      resetHistory: s.reset,
    })),
  );
  const { state: noteInputState, setCursor, setCondensingRouting } = useNoteInput();

  return {
    store,
    ...doc,
    selection,
    clearSelection,
    selectRange,
    selectElement,
    ...hist,
    historyStore,
    noteInputState,
    setCursor,
    setCondensingRouting,
  };
}
