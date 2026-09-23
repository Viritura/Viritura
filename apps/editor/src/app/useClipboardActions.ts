import { useCallback } from "react";
import { copyToClipboard, cutToClipboard, applyCut, type ClipboardSelection } from "../commands/clipboardCommands";
import { FRAGMENT_VERSION } from "../clipboard/ClipboardFragment";
import { addClipboardEntry, type ClipboardSourceRef } from "../store/clipboardHistoryStore";
import {
  buildClipboardSelection,
  buildClipboardSourceRef as buildClipboardSourceRefImpl,
} from "../clipboard/buildClipboardSelection";
import { computePasteResult } from "../clipboard/computePasteResult";
import { projectNoteheadSelection, removeSelectedNoteheads } from "../clipboard/noteheadScope";
import { computeRepeatResult } from "../clipboard/computeRepeatResult";
import type { useDocumentStoreApi } from "../store/DocumentContext";
import type { useHistoryStoreInstance } from "../store/historyStore";
import { useSelectionActions, type SelectionState } from "../store/selectionStore";
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
import { readNotationClipboard, writeNotationClipboard, NotationClipboardError } from "../clipboard/notationClipboard";
import { looksLikeMuseScoreXml, MuseScoreConversionError } from "@viritura/musescore-clipboard";
import { acquireClipboardPaste } from "./clipboardPasteAcquisition";

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
  /** Paste, adding pitches to destination chords instead of replacing them. */
  handlePasteMerge: () => Promise<void>;
  handleRepeat: () => void;
}

/** The clipboard-history entry for a captured selection, shared by copy and cut. */
function historyFragment(sel: ClipboardSelection) {
  return {
    type: "viritura/fragment" as const,
    version: FRAGMENT_VERSION,
    timeSignature: sel.timeSignature,
    keySignature: sel.keySignature,
    content: sel.events,
    ...(sel.clef ? { clef: sel.clef } : {}),
    ...(sel.transposition ? { transposition: sel.transposition } : {}),
    ...(sel.dynamics && sel.dynamics.length > 0 ? { dynamics: sel.dynamics } : {}),
    ...(sel.chordSymbols && sel.chordSymbols.length > 0 ? { chordSymbols: sel.chordSymbols } : {}),
    ...(sel.measureRepeats && sel.measureRepeats.length > 0 ? { measureRepeats: sel.measureRepeats } : {}),
    ...(sel.lyrics ? { lyrics: sel.lyrics } : {}),
    tracks: sel.tracks,
  };
}

function showClipboardWarnings(warnings: readonly string[]): void {
  const messages = [...new Set(warnings)];
  if (messages.length === 0) return;
  const remaining = messages.length > 3 ? `; and ${messages.length - 3} more warnings` : "";
  toast.warning(`${messages.slice(0, 3).join("; ")}${remaining}`);
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
  const { selectElements } = useSelectionActions();
  const applyResultSelection = useCallback(
    (next: SelectionState | null) => {
      if (next?.kind === "single") selectElement(next.elementId);
      else if (next?.kind === "range") selectRange(next.startElementId, next.endElementId);
      else if (next?.kind === "multi") selectElements(next.elementIds, next.measureAnchor, next.rhythmicRange);
    },
    [selectElement, selectRange, selectElements],
  );
  const getClipboardSelection = useCallback((): ClipboardSelection | null => {
    const score = store.getState().score;
    if (!score) return null;
    // Notehead selections capture from a projection holding only those notes,
    // so the ordinary event-level capture rules still apply.
    return buildClipboardSelection(projectNoteheadSelection(score, selection), selection, selectedScoreIndex);
  }, [store, selection, selectedScoreIndex]);

  const buildClipboardSourceRef = useCallback((): ClipboardSourceRef | undefined => {
    return buildClipboardSourceRefImpl(store.getState().score, selection, historyStore.getState().currentEntryId);
  }, [store, historyStore, selection]);

  const handleCopy = useCallback(async () => {
    const score = store.getState().score;
    const lyricText = score ? selectedLyricText(score, selection) : null;
    if (lyricText !== null) {
      try {
        await writeNotationClipboard({ text: lyricText });
      } catch {
        toast.error("Could not copy the selected lyric.");
      }
      return;
    }
    const sel = getClipboardSelection();
    if (!sel) return;
    let copied = false;
    try {
      copied = await copyToClipboard(sel);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not copy notation.");
    }
    if (copied) {
      const source = buildClipboardSourceRef();
      addClipboardEntry(historyFragment(sel), source);
    }
  }, [store, selection, getClipboardSelection, buildClipboardSourceRef]);

  const handleCut = useCallback(async () => {
    const { score } = store.getState();
    if (!score) return;
    const lyricElementId = selection.kind === "single" ? selection.elementId : null;
    const lyric = lyricElementId ? resolveSelectedLyric(score, lyricElementId) : null;
    if (lyric && lyricElementId) {
      try {
        await writeNotationClipboard({ text: lyric.line.text });
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
    const result = await cutToClipboard(sel, (message) => toast.warning(message));
    if (result) {
      addClipboardEntry(historyFragment(sel), buildClipboardSourceRef());
      const noteheadCut = removeSelectedNoteheads(score, selection);
      updateScore(noteheadCut ?? applyCut(score, result));
      if (noteheadCut) clearSelection();
    }
  }, [getClipboardSelection, store, selection, updateScore, buildClipboardSourceRef, clearSelection]);

  const runPaste = useCallback(
    async (merge: boolean) => {
      const { score } = store.getState();
      if (!score) return;
      if (selection.kind === "single" && resolveSelectedLyric(score, selection.elementId)) {
        try {
          const clipboard = await readNotationClipboard();
          if (clipboard.museScore || looksLikeMuseScoreXml(clipboard.text) || deserializeFragment(clipboard.text)) {
            toast.info("Select a note or rhythmic position to paste notation.");
            return;
          }
          const next = pasteTextIntoSelectedLyric(score, selection, clipboard.text);
          if (next) updateScore(next);
        } catch {
          toast.error("Could not paste into the selected lyric.");
        }
        return;
      }
      const warnings: string[] = [];
      let paste;
      try {
        paste = await acquireClipboardPaste((message) => warnings.push(message));
      } catch (error) {
        if (error instanceof MuseScoreConversionError) toast.error(error.userMessage());
        else if (error instanceof NotationClipboardError) toast.error(error.message);
        else toast.error("Could not read notation from the clipboard.");
        return;
      }
      if (!paste) {
        showClipboardWarnings(warnings);
        return;
      }
      const noteInput = useNoteInputStore.getState();
      const pasteCursor =
        noteInput.active && noteInput.cursorPosition
          ? { ...noteInput.cursorPosition, voice: noteInput.currentVoice - 1 }
          : undefined;
      try {
        const result = computePasteResult(score, selection, paste, pasteCursor, { merge });
        if (!result) {
          showClipboardWarnings(warnings);
          return;
        }
        updateScore(result.newScore);
        if (result.cursorAfterPaste) noteInputActions.setCursor(result.cursorAfterPaste);
        applyResultSelection(result.selection);
        showClipboardWarnings([...warnings, ...result.warnings]);
      } catch (error) {
        console.error("[Viritura paste] Paste failed", { error, selection, pasteCursor, merge });
        toast.error(error instanceof Error ? error.message : "Could not paste notation.");
      }
    },
    [store, selection, updateScore, applyResultSelection],
  );

  const handlePaste = useCallback(async () => {
    await runPaste(false);
  }, [runPaste]);

  const handlePasteMerge = useCallback(async () => {
    await runPaste(true);
  }, [runPaste]);

  const handleRepeat = useCallback(() => {
    const sel = getClipboardSelection();
    const { score } = store.getState();
    if (!sel || !score) return;
    try {
      const result = computeRepeatResult(score, sel);
      if (!result) return;
      updateScore(result.newScore);
      applyResultSelection(result.selection);
      showClipboardWarnings(result.warnings);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not repeat notation.");
    }
  }, [store, getClipboardSelection, updateScore, applyResultSelection]);

  return {
    getClipboardSelection,
    buildClipboardSourceRef,
    handleCopy,
    handleCut,
    handlePaste,
    handlePasteMerge,
    handleRepeat,
  };
}
