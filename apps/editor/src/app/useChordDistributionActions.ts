import { useCallback } from "react";
import { toast } from "sonner";
import type { Score } from "@viritura/core";
import { MuseScoreConversionError } from "@viritura/musescore-clipboard";
import {
  destinationStaffCount,
  explodePasteResult,
  FragmentDistributionError,
  reducePasteResult,
} from "../score/chordDistribution";
import { chordLineNoteIds, type ChordEdge } from "../store/chordNoteSelection";
import { useSelectionActions, type SelectionState } from "../store/selectionStore";
import type { useDocumentStoreApi } from "../store/DocumentContext";
import { acquireClipboardPaste } from "./clipboardPasteAcquisition";
import { computePasteResult } from "../clipboard/computePasteResult";
import { noteInputActions, useNoteInputStore } from "../store/noteInputStore";
import { NotationClipboardError } from "../clipboard/notationClipboard";

interface UseChordDistributionActionsArgs {
  store: ReturnType<typeof useDocumentStoreApi>;
  selection: SelectionState;
  updateScore: (next: Score) => void;
  selectRange: (start: string, end: string) => void;
  selectElement: (id: string) => void;
}

export interface ChordDistributionActions {
  /** Fan copied pitches out across destination staves. */
  handleExplodeSelection: () => Promise<void>;
  /** Merge copied staves as chords on the destination staff. */
  handleReduceSelection: () => Promise<void>;
  /** Select the top notehead of every selected chord. */
  handleSelectChordTopNote: () => void;
  /** Select the bottom notehead of every selected chord. */
  handleSelectChordBottomNote: () => void;
  canDistribute: boolean;
}

type DistributionMode = "explode" | "reduce";

const EMPTY_CLIPBOARD_MESSAGE = "Copy the music to distribute first.";
const EMPTY_DESTINATION_MESSAGE = "Select a destination for the copied music first.";

export function useChordDistributionActions({
  store,
  selection,
  updateScore,
  selectRange,
  selectElement,
}: UseChordDistributionActionsArgs): ChordDistributionActions {
  const { selectElements } = useSelectionActions();
  const hasInputCursor = useNoteInputStore((state) => state.active && state.cursorPosition !== null);

  const applyResultSelection = useCallback(
    (next: SelectionState | null) => {
      if (next?.kind === "single") selectElement(next.elementId);
      else if (next?.kind === "range") selectRange(next.startElementId, next.endElementId);
      else if (next?.kind === "multi") selectElements(next.elementIds, next.measureAnchor, next.rhythmicRange);
    },
    [selectElement, selectRange, selectElements],
  );

  const distribute = useCallback(
    async (mode: DistributionMode) => {
      const { score } = store.getState();
      const noteInput = useNoteInputStore.getState();
      const pasteCursor =
        noteInput.active && noteInput.cursorPosition
          ? { ...noteInput.cursorPosition, voice: noteInput.currentVoice - 1 }
          : undefined;
      if (!score || (selection.kind === "none" && !pasteCursor)) {
        toast.info(EMPTY_DESTINATION_MESSAGE);
        return;
      }

      const warnings: string[] = [];
      try {
        const paste = await acquireClipboardPaste((message) => warnings.push(message));
        if (!paste) {
          toast.info(EMPTY_CLIPBOARD_MESSAGE);
          return;
        }
        const transformed =
          mode === "reduce"
            ? reducePasteResult(paste)
            : explodePasteResult(paste, destinationStaffCount(score, selection));
        const result = computePasteResult(score, selection, transformed, pasteCursor, { merge: false });
        if (!result) {
          toast.info(EMPTY_DESTINATION_MESSAGE);
          return;
        }
        updateScore(result.newScore);
        if (result.cursorAfterPaste) noteInputActions.setCursor(result.cursorAfterPaste);
        applyResultSelection(result.selection);
        for (const warning of new Set([...warnings, ...result.warnings])) toast.warning(warning);
      } catch (error) {
        if (error instanceof FragmentDistributionError) toast.info(error.message);
        else if (error instanceof MuseScoreConversionError) toast.error(error.userMessage());
        else if (error instanceof NotationClipboardError) toast.error(error.message);
        else {
          console.error("[Viritura chord distribution] Paste failed", { error, selection, mode, pasteCursor });
          toast.error(error instanceof Error ? error.message : "Could not distribute the copied music.");
        }
      }
    },
    [store, selection, updateScore, applyResultSelection],
  );

  const selectChordLine = useCallback(
    (edge: ChordEdge) => {
      const { score } = store.getState();
      if (!score || selection.kind === "none") return;
      const ids = chordLineNoteIds(score, selection, edge);
      if (ids.length === 0) {
        toast.info("The selection has no chord notes to isolate.");
        return;
      }
      selectElements(ids);
    },
    [store, selection, selectElements],
  );

  return {
    handleExplodeSelection: useCallback(() => distribute("explode"), [distribute]),
    handleReduceSelection: useCallback(() => distribute("reduce"), [distribute]),
    handleSelectChordTopNote: useCallback(() => selectChordLine("top"), [selectChordLine]),
    handleSelectChordBottomNote: useCallback(() => selectChordLine("bottom"), [selectChordLine]),
    canDistribute: Boolean(store.getState().score && (selection.kind !== "none" || hasInputCursor)),
  };
}
