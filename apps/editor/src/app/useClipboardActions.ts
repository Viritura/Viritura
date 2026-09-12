import { useCallback } from "react";
import {
  copyToClipboard,
  cutToClipboard,
  pasteFromClipboard,
  pasteResultFromFragment,
  applyCut,
  type ClipboardSelection,
} from "../commands/clipboardCommands";
import { FRAGMENT_VERSION } from "../clipboard/ClipboardFragment";
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
import { noteInputActions, useNoteInputStore } from "../store/noteInputStore";
import { deserializeFragment } from "../clipboard/deserialize";
import {
  pasteTextIntoSelectedLyric,
  removeLyricByElementId,
  resolveSelectedLyric,
  selectedLyricText,
} from "../commands/lyricCommands";
import { toast } from "sonner";

type SelectionState = ReturnType<typeof useSelection>;

interface UseClipboardActionsArgs {
  store: ReturnType<typeof useDocumentStoreApi>;
  historyStore: ReturnType<typeof useHistoryStoreInstance>;
  selection: SelectionState;
  updateScore: (next: Score) => void;
  selectRange: (start: string, end: string) => void;
  selectElement: (id: string) => void;
  clearSelection: () => void;
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
  clearSelection,
}: UseClipboardActionsArgs): ClipboardActions {
  const selectedScoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const getClipboardSelection = useCallback((): ClipboardSelection | null => {
    return buildClipboardSelection(store.getState().score, selection, selectedScoreIndex);
  }, [store, selection, selectedScoreIndex]);

  const buildClipboardSourceRef = useCallback((): ClipboardSourceRef | undefined => {
    return buildClipboardSourceRefImpl(store.getState().score, selection, historyStore.getState().currentEntryId);
  }, [store, historyStore, selection]);

  const handleCopy = useCallback(async () => {
    const score = store.getState().score;
    const lyricText = score ? selectedLyricText(score, selection) : null;
    if (lyricText !== null) {
      try {
        await navigator.clipboard.writeText(lyricText);
      } catch {
        toast.error("Could not copy the selected lyric.");
      }
      return;
    }
    const sel = getClipboardSelection();
    if (!sel) return;
    const copied = await copyToClipboard(sel);
    if (copied) {
      const source = buildClipboardSourceRef();
      addClipboardEntry(
        {
          type: "viritura/fragment" as const,
          version: FRAGMENT_VERSION,
          timeSignature: sel.timeSignature,
          keySignature: sel.keySignature,
          content: sel.events,
          ...(sel.clef ? { clef: sel.clef } : {}),
          ...(sel.transposition ? { transposition: sel.transposition } : {}),
          ...(sel.dynamics && sel.dynamics.length > 0 ? { dynamics: sel.dynamics } : {}),
          ...(sel.measureRepeats && sel.measureRepeats.length > 0 ? { measureRepeats: sel.measureRepeats } : {}),
          ...(sel.lyrics ? { lyrics: sel.lyrics } : {}),
          tracks: sel.tracks,
        },
        source,
      );
    }
  }, [store, selection, getClipboardSelection, buildClipboardSourceRef]);

  const handleCut = useCallback(async () => {
    const { score } = store.getState();
    if (!score) return;
    const lyricElementId = selection.kind === "single" ? selection.elementId : null;
    const lyric = lyricElementId ? resolveSelectedLyric(score, lyricElementId) : null;
    if (lyric && lyricElementId) {
      try {
        await navigator.clipboard.writeText(lyric.line.text);
      } catch {
        toast.error("Could not cut the selected lyric.");
        return;
      }
      const next = removeLyricByElementId(score, lyricElementId);
      if (next) {
        updateScore(next);
        clearSelection();
      }
      return;
    }
    const sel = getClipboardSelection();
    if (!sel) return;
    const result = await cutToClipboard(sel);
    if (result) {
      addClipboardEntry(
        {
          type: "viritura/fragment",
          version: FRAGMENT_VERSION,
          timeSignature: sel.timeSignature,
          keySignature: sel.keySignature,
          content: sel.events,
          ...(sel.clef ? { clef: sel.clef } : {}),
          ...(sel.transposition ? { transposition: sel.transposition } : {}),
          ...(sel.dynamics && sel.dynamics.length > 0 ? { dynamics: sel.dynamics } : {}),
          ...(sel.measureRepeats && sel.measureRepeats.length > 0 ? { measureRepeats: sel.measureRepeats } : {}),
          ...(sel.lyrics ? { lyrics: sel.lyrics } : {}),
          tracks: sel.tracks,
        },
        buildClipboardSourceRef(),
      );
      const newScore = applyCut(score, result);
      updateScore(newScore);
    }
  }, [getClipboardSelection, store, selection, updateScore, buildClipboardSourceRef, clearSelection]);

  const handlePaste = useCallback(async () => {
    const { score } = store.getState();
    if (!score) return;
    if (selection.kind === "single" && resolveSelectedLyric(score, selection.elementId)) {
      try {
        const text = await navigator.clipboard.readText();
        if (deserializeFragment(text)) {
          toast.info("Select a note or rhythmic position to paste notation.");
          return;
        }
        const next = pasteTextIntoSelectedLyric(score, selection, text);
        if (next) updateScore(next);
      } catch {
        toast.error("Could not paste into the selected lyric.");
      }
      return;
    }
    const paste =
      (await pasteFromClipboard()) ??
      (() => {
        const latest = useClipboardHistoryStore.getState().entries[0];
        return latest ? pasteResultFromFragment(latest.fragment) : null;
      })();
    if (!paste) return;
    const noteInput = useNoteInputStore.getState();
    const pasteCursor =
      noteInput.active && noteInput.cursorPosition
        ? { ...noteInput.cursorPosition, voice: noteInput.currentVoice - 1 }
        : undefined;
    try {
      const result = computePasteResult(score, selection, paste, pasteCursor);
      if (!result) return;
      updateScore(result.newScore);
      if (result.cursorAfterPaste) noteInputActions.setCursor(result.cursorAfterPaste);
      if (result.range) {
        if (result.range.start === result.range.end) selectElement(result.range.start);
        else selectRange(result.range.start, result.range.end);
      }
    } catch (error) {
      console.error("[Viritura paste] Paste failed", { error, selection, pasteCursor });
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
