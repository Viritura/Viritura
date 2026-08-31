import { useCallback, useMemo, type RefObject } from "react";
import { produce } from "../score/scoreClone";
import { resolveEventLocation } from "../score/ElementPath";
import { buildNavigationIndex, type NavigationIndex } from "../navigation/NavigationIndex";
import type { LyricInputState } from "../components/LyricInput";
import type { DocumentStore } from "../store/documentStore";
import type { ScoreCanvasHandle } from "../components/ScoreCanvas";
import type { LyricLineType, SequenceContent, Score } from "@viritura/core";

export interface LyricStateRef {
  elementId: string;
  lineId: string;
}

interface UseLyricHandlersOptions {
  store: DocumentStore;
  updateScore: (next: Score) => void;
  lyricMode: boolean;
  lyricState: LyricStateRef | null;
  setLyricMode: (v: boolean) => void;
  setLyricState: (s: LyricStateRef | null) => void;
  canvasRef: RefObject<ScoreCanvasHandle | null>;
}

export function useLyricHandlers({
  store,
  updateScore,
  lyricMode,
  lyricState,
  setLyricMode,
  setLyricState,
  canvasRef,
}: UseLyricHandlersOptions) {
  const lyricNavIndex = useMemo<NavigationIndex | null>(() => {
    if (!lyricMode) return null;
    const { score } = store.getState();
    if (!score) return null;
    return buildNavigationIndex(score);
  }, [store, lyricMode]);

  const lyricPosition = useMemo<{ x: number; y: number } | null>(() => {
    if (!lyricMode || !lyricState) return null;
    const si = canvasRef.current?.getSpatialIndex();
    const canvas = canvasRef.current?.getCanvasElement();
    const vp = canvasRef.current?.getViewport();
    if (!si || !canvas || !vp) return null;
    const bbox = si.getBBox(lyricState.elementId);
    if (!bbox) return null;
    const rect = canvas.getBoundingClientRect();
    const verseNum = parseInt(lyricState.lineId, 10) || 1;
    const lyricYOffset = 20 + (verseNum - 1) * 16;
    const screenX = (bbox.x + bbox.width / 2 - vp.scrollX) * vp.zoom + rect.left;
    const screenY = (bbox.y + bbox.height - vp.scrollY) * vp.zoom + rect.top + lyricYOffset;
    return { x: screenX, y: screenY };
  }, [lyricMode, lyricState, canvasRef]);

  const handleLyricCommit = useCallback(
    (elementId: string, lineId: string, text: string, type: LyricLineType) => {
      const { score } = store.getState();
      if (!score) return;
      const newScore = produce(score, (draft) => {
        const loc = resolveEventLocation(elementId, score);
        if (!loc) return;
        const content =
          loc.tupletIndex !== undefined
            ? (
                draft.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex]?.content[
                  loc.tupletIndex
                ] as { content: SequenceContent[] }
              )?.content
            : draft.parts[loc.partIndex]?.measures[loc.measureIndex]?.sequences[loc.sequenceIndex]?.content;
        if (!content) return;
        const ev = content[loc.eventIndex];
        if (!ev || ev.type !== "event") return;
        if (!ev.lyrics) ev.lyrics = {};
        if (!ev.lyrics.lines) ev.lyrics.lines = {};
        ev.lyrics.lines[lineId] = { text, ...(type !== "whole" ? { type } : {}) };
      });
      if (newScore !== score) updateScore(newScore);
    },
    [store, updateScore],
  );

  const handleLyricNavigate = useCallback(
    (nextState: LyricInputState) => {
      setLyricState(nextState);
    },
    [setLyricState],
  );

  const handleLyricExit = useCallback(() => {
    setLyricMode(false);
    setLyricState(null);
  }, [setLyricMode, setLyricState]);

  return {
    lyricNavIndex,
    lyricPosition,
    handleLyricCommit,
    handleLyricNavigate,
    handleLyricExit,
  };
}
