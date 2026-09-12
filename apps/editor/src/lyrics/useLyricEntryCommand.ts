import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { LyricInputState } from "../components/LyricInput";
import type { DocumentStore } from "../store/documentStore";
import { setActiveLyricLineId, useOverlayStore } from "../store/overlayStore";
import type { SelectionState } from "../store/selectionStore";
import { toggleNoteInputMode } from "../store/noteInputStore";
import { createLyricInputState, getInitialLyricLineId, getLyricLineIds } from "./lineMetadata";

interface UseLyricEntryCommandOptions {
  store: DocumentStore;
  selection: SelectionState;
  noteInputActive: boolean;
  lyricMode: boolean;
  setLyricMode: (active: boolean) => void;
  setLyricState: (state: LyricInputState | null) => void;
  onOpenLyricsPalette: () => void;
  enabled: boolean;
}

/** Shared entry command used by the toolbar, keyboard shortcut, and Jump Bar. */
export function useLyricEntryCommand({
  store,
  selection,
  noteInputActive,
  lyricMode,
  setLyricMode,
  setLyricState,
  onOpenLyricsPalette,
  enabled,
}: UseLyricEntryCommandOptions): () => void {
  useEffect(() => {
    if (enabled || !lyricMode) return;
    setLyricMode(false);
    setLyricState(null);
  }, [enabled, lyricMode, setLyricMode, setLyricState]);

  return useCallback(() => {
    if (!enabled) {
      toast.info("Switch to Write mode before entering lyrics.");
      return;
    }
    onOpenLyricsPalette();
    const { score } = store.getState();
    if (!score) {
      toast.error("Open a score before entering lyrics.");
      return;
    }
    if (lyricMode) {
      setLyricMode(false);
      setLyricState(null);
      return;
    }
    const lineIds = getLyricLineIds(score);
    const configuredLineId = useOverlayStore.getState().activeLyricLineId;
    const lineId = lineIds.includes(configuredLineId) ? configuredLineId : getInitialLyricLineId(score);
    const next = createLyricInputState(score, selection, lineId);
    if (!next) {
      toast.info("Select a note or chord before starting lyric entry.");
      return;
    }
    if (noteInputActive) toggleNoteInputMode();
    setActiveLyricLineId(lineId);
    setLyricState(next);
    setLyricMode(true);
  }, [enabled, lyricMode, noteInputActive, onOpenLyricsPalette, selection, setLyricMode, setLyricState, store]);
}
