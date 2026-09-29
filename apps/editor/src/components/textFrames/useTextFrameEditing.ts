import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  textContentFromPlain,
  type Score,
  type TextFrame,
  type TextFrameLocator,
  type TextFrameWidth,
} from "@viritura/core";
import { useDocument, useDocumentActions } from "../../store/DocumentContext";
import { useSelection } from "../../store/selectionStore";
import { useViewStateStore } from "../../store/viewStateStore";
import {
  addTextFrameInScore,
  buildTextFrame,
  deleteTextFrameInScore,
  moveTextFrameInScore,
  reorderTextFrameInScore,
  resizeTextFrameInScore,
  textFramesForScore,
  updateTextFrameInScore,
  type TextFrameLayerCommand,
} from "../../score/textFrameMutations";
import { textFrameIdFromElementId } from "./textFrameContext";
import { useTextFrameSelectionStore } from "./textFrameSelection";

/** Staff spaces moved by one nudge; Shift multiplies by {@link TEXT_FRAME_COARSE_NUDGE}. */
export const TEXT_FRAME_NUDGE = 1;
export const TEXT_FRAME_COARSE_NUDGE = 5;

/** Presentation fields edited in place; geometry and content have dedicated actions. */
type TextFramePresentation = Partial<
  Pick<TextFrame, "placement" | "horizontalAlignment" | "paragraphJustification" | "padding" | "border">
>;

export interface TextFrameEditing {
  score: Score | null;
  scoreIndex: number;
  /** Frames of the active score view, in paint order (last is on top). */
  frames: readonly TextFrame[];
  selectedFrame: TextFrame | null;
  selectFrame: (id: string | null) => void;
  createFrame: (locator: TextFrameLocator) => void;
  setText: (id: string, text: string) => void;
  move: (id: string, delta: { x: number; y: number }) => void;
  resize: (id: string, width: TextFrameWidth) => void;
  setPresentation: (id: string, presentation: TextFramePresentation) => void;
  reorder: (id: string, command: TextFrameLayerCommand) => void;
  remove: (id: string) => void;
}

/**
 * Editing surface for the active score view's text frames. Every action goes
 * through `updateScore`, so each is one undoable history step.
 */
export function useTextFrameEditing(): TextFrameEditing {
  const { score } = useDocument();
  const { updateScore } = useDocumentActions();
  const scoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const selectedFrameId = useTextFrameSelectionStore((state) => state.selectedFrameId);
  const selectFrame = useTextFrameSelectionStore((state) => state.setSelectedFrameId);

  const frames = textFramesForScore(score, scoreIndex);
  const selection = useSelection();
  const canvasFrameId = selection.kind === "single" ? textFrameIdFromElementId(selection.elementId, frames) : null;
  // Mirror canvas selection changes: a painted frame (`text-frame/{id}`) selects
  // it; anything else clears the frame. Panel-initiated frame selection leaves
  // the score selection untouched, so it survives until the canvas changes.
  const previousSelection = useRef(selection);
  useEffect(() => {
    if (previousSelection.current === selection) return;
    previousSelection.current = selection;
    selectFrame(canvasFrameId);
  }, [selection, canvasFrameId, selectFrame]);
  const selectedFrame = useMemo(
    () => frames.find((frame) => frame.id === selectedFrameId) ?? null,
    [frames, selectedFrameId],
  );

  const commit = useCallback(
    (edit: (current: Score) => Score) => {
      if (!score) return;
      const next = edit(score);
      if (next !== score) updateScore(next);
    },
    [score, updateScore],
  );

  const createFrame = useCallback(
    (locator: TextFrameLocator) => {
      if (!score?.scores?.[scoreIndex]) return;
      const frame = buildTextFrame(score, { locator });
      commit((current) => addTextFrameInScore(current, scoreIndex, frame));
      selectFrame(frame.id);
    },
    [score, scoreIndex, commit, selectFrame],
  );

  const setText = useCallback(
    (id: string, text: string) =>
      commit((current) =>
        updateTextFrameInScore(current, scoreIndex, id, (frame) => ({ ...frame, content: textContentFromPlain(text) })),
      ),
    [commit, scoreIndex],
  );

  const setPresentation = useCallback(
    (id: string, presentation: TextFramePresentation) =>
      commit((current) => updateTextFrameInScore(current, scoreIndex, id, (frame) => ({ ...frame, ...presentation }))),
    [commit, scoreIndex],
  );

  const remove = useCallback(
    (id: string) => {
      commit((current) => deleteTextFrameInScore(current, scoreIndex, id));
      if (selectedFrameId === id) selectFrame(null);
    },
    [commit, scoreIndex, selectedFrameId, selectFrame],
  );

  return {
    score,
    scoreIndex,
    frames,
    selectedFrame,
    selectFrame,
    createFrame,
    setText,
    move: useCallback(
      (id: string, delta: { x: number; y: number }) =>
        commit((current) => moveTextFrameInScore(current, scoreIndex, id, delta)),
      [commit, scoreIndex],
    ),
    resize: useCallback(
      (id: string, width: TextFrameWidth) =>
        commit((current) => resizeTextFrameInScore(current, scoreIndex, id, width)),
      [commit, scoreIndex],
    ),
    setPresentation,
    reorder: useCallback(
      (id: string, command: TextFrameLayerCommand) =>
        commit((current) => reorderTextFrameInScore(current, scoreIndex, id, command)),
      [commit, scoreIndex],
    ),
    remove,
  };
}
