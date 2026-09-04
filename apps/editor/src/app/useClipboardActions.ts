import { useCallback } from "react";
import {
  copyToClipboard,
  cutToClipboard,
  pasteFromClipboard,
  pasteResultFromFragment,
  applyCut,
  type ClipboardSelection,
} from "../commands/clipboardCommands";
import { addClipboardEntry, useClipboardHistoryStore, type ClipboardSourceRef } from "../store/clipboardHistoryStore";
import {
  buildClipboardSelection,
  buildClipboardSourceRef as buildClipboardSourceRefImpl,
} from "../clipboard/buildClipboardSelection";
import { computePasteResult } from "../clipboard/computePasteResult";
import { computeRepeatResult } from "../clipboard/computeRepeatResult";
import type { useDocumentStoreApi } from "../store/DocumentContext";
import type { useHistoryStoreInstance } from "../store/historyStore";
import type { useSelection } from "../store/selectionStore";
import type { Score } from "@viritura/core";
import { useViewStateStore } from "../store/viewStateStore";

type SelectionState = ReturnType<typeof useSelection>;

interface UseClipboardActionsArgs {
  store: ReturnType<typeof useDocumentStoreApi>;
  historyStore: ReturnType<typeof useHistoryStoreInstance>;
  selection: SelectionState;
  updateScore: (next: Score) => void;
  selectRange: (start: string, end: string) => void;
  selectElement: (id: string) => void;
}

export interface ClipboardActions {
  getClipboardSelection: () => ClipboardSelection | null;
  buildClipboardSourceRef: () => ClipboardSourceRef | undefined;
  handleCopy: () => Promise<void>;
  handleCut: () => Promise<void>;
  handlePaste: () => Promise<void>;
  handleRepeat: () => void;
}

export function useClipboardActions({
  store,
  historyStore,
  selection,
  updateScore,
  selectRange,
  selectElement,
}: UseClipboardActionsArgs): ClipboardActions {
  const selectedScoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const getClipboardSelection = useCallback((): ClipboardSelection | null => {
    return buildClipboardSelection(store.getState().score, selection, selectedScoreIndex);
  }, [store, selection, selectedScoreIndex]);

  const buildClipboardSourceRef = useCallback((): ClipboardSourceRef | undefined => {
    return buildClipboardSourceRefImpl(store.getState().score, selection, historyStore.getState().currentEntryId);
  }, [store, historyStore, selection]);

  const handleCopy = useCallback(async () => {
    const sel = getClipboardSelection();
    if (!sel) return;
    const copied = await copyToClipboard(sel);
    if (copied) {
      const source = buildClipboardSourceRef();
      addClipboardEntry(
        {
          type: "viritura/fragment" as const,
          version: 2,
          timeSignature: sel.timeSignature,
          keySignature: sel.keySignature,
          content: sel.events,
          ...(sel.clef ? { clef: sel.clef } : {}),
          ...(sel.transposition ? { transposition: sel.transposition } : {}),
          ...(sel.dynamics && sel.dynamics.length > 0 ? { dynamics: sel.dynamics } : {}),
          ...(sel.measureRepeats && sel.measureRepeats.length > 0 ? { measureRepeats: sel.measureRepeats } : {}),
          tracks: sel.tracks,
        },
        source,
      );
    }
  }, [getClipboardSelection, buildClipboardSourceRef]);

  const handleCut = useCallback(async () => {
    const sel = getClipboardSelection();
    const { score } = store.getState();
    if (!sel || !score) return;
    const result = await cutToClipboard(sel);
    if (result) {
      addClipboardEntry(
        {
          type: "viritura/fragment",
          version: 2,
          timeSignature: sel.timeSignature,
          keySignature: sel.keySignature,
          content: sel.events,
          ...(sel.clef ? { clef: sel.clef } : {}),
          ...(sel.transposition ? { transposition: sel.transposition } : {}),
          ...(sel.dynamics && sel.dynamics.length > 0 ? { dynamics: sel.dynamics } : {}),
          ...(sel.measureRepeats && sel.measureRepeats.length > 0 ? { measureRepeats: sel.measureRepeats } : {}),
          tracks: sel.tracks,
        },
        buildClipboardSourceRef(),
      );
      const newScore = applyCut(score, result);
      updateScore(newScore);
    }
  }, [getClipboardSelection, store, updateScore, buildClipboardSourceRef]);

  const handlePaste = useCallback(async () => {
    const { score } = store.getState();
    if (!score) return;
    const paste =
      (await pasteFromClipboard()) ??
      (() => {
        const latest = useClipboardHistoryStore.getState().entries[0];
        return latest ? pasteResultFromFragment(latest.fragment) : null;
      })();
    if (!paste) return;
    const result = computePasteResult(score, selection, paste);
    if (!result) return;
    updateScore(result.newScore);
    if (result.range) {
      if (result.range.start === result.range.end) selectElement(result.range.start);
      else selectRange(result.range.start, result.range.end);
    }
  }, [store, selection, updateScore, selectRange, selectElement]);

  const handleRepeat = useCallback(() => {
    const sel = getClipboardSelection();
    const { score } = store.getState();
    if (!sel || !score) return;
    const result = computeRepeatResult(score, sel);
    if (!result) return;
    updateScore(result.newScore);
    if (result.range) {
      if (result.range.start === result.range.end) selectElement(result.range.start);
      else selectRange(result.range.start, result.range.end);
    }
  }, [store, getClipboardSelection, updateScore, selectRange, selectElement]);

  return {
    getClipboardSelection,
    buildClipboardSourceRef,
    handleCopy,
    handleCut,
    handlePaste,
    handleRepeat,
  };
}
