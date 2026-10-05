import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  type Score,
  type TextFrame,
  type TextFrameLocator,
  type TextFrameWidth,
  type TextContent,
  type TextFramePresentation,
} from "@viritura/core";
import { useDocument, useDocumentActions } from "../../store/DocumentContext";
import { useSelection, useSelectionActions } from "../../store/selectionStore";
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
import { selectedStaffDestination, textFrameIdFromElementId } from "./textFrameContext";
import { pageTextToStaff } from "../../score/textFrameAttachment";
import { produce } from "../../score/scoreClone";
import { ensureMeasureId } from "../../score/spanUtils";
import { useTextFrameSelectionStore } from "./textFrameSelection";

/** Staff spaces moved by one nudge; Shift multiplies by {@link TEXT_FRAME_COARSE_NUDGE}. */
export const TEXT_FRAME_NUDGE = 1;
export const TEXT_FRAME_COARSE_NUDGE = 5;

/** Presentation fields edited in place; geometry and content have dedicated actions. */
type EditableTextFramePresentation = Partial<
  Pick<TextFrame, "placement" | "horizontalAlignment" | "paragraphJustification" | "padding" | "border">
> &
  Pick<TextFramePresentation, "eraseBackground">;

export interface TextFrameEditing {
  score: Score | null;
  scoreIndex: number;
  /** Frames of the active score view, in paint order (last is on top). */
  frames: readonly TextFrame[];
  selectedFrame: TextFrame | null;
  selectFrame: (id: string | null) => void;
  createFrame: (locator: TextFrameLocator) => void;
  setContent: (id: string, content: TextContent) => void;
  setLocator: (id: string, locator: TextFrameLocator) => void;
  followMeasure: (id: string, measureIndex: number) => void;
  toStaff: (id: string) => void;
  move: (id: string, delta: { x: number; y: number }) => void;
  resize: (id: string, width: TextFrameWidth) => void;
  setPresentation: (id: string, presentation: EditableTextFramePresentation) => void;
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
  const { selectElement } = useSelectionActions();
  const canvasFrameId = selection.kind === "single" ? textFrameIdFromElementId(selection.elementId, frames) : null;
  // Mirror canvas selection changes: a painted frame (`text-frame/{id}`) selects
  // it; anything else clears the frame. Panel-initiated frame selection leaves
  // the score selection untouched, so it survives until the canvas changes.
  const previousSelection = useRef<typeof selection | null>(null);
  useEffect(() => {
    if (previousSelection.current === selection) return;
    const initialMount = previousSelection.current === null;
    previousSelection.current = selection;
    if (initialMount && canvasFrameId === null) return;
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

  const setPresentation = useCallback(
    (id: string, presentation: EditableTextFramePresentation) =>
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
    setContent: (id, content) =>
      commit((current) => updateTextFrameInScore(current, scoreIndex, id, (frame) => ({ ...frame, content }))),
    setLocator: (id, locator) =>
      commit((current) => updateTextFrameInScore(current, scoreIndex, id, (frame) => ({ ...frame, locator }))),
    followMeasure: (id, measureIndex) =>
      commit((current) => {
        const next = produce(current, (draft) => {
          ensureMeasureId(draft, measureIndex);
        });
        const measureId = next.global.measures[measureIndex]!.id!;
        return updateTextFrameInScore(next, scoreIndex, id, (frame) => ({
          ...frame,
          locator: { type: "globalMeasure", measureId },
        }));
      }),
    toStaff: (id) => {
      if (!score) return;
      const result = pageTextToStaff(score, scoreIndex, id, selectedStaffDestination(score, selection));
      updateScore(result.score);
      selectFrame(null);
      selectElement(result.elementId);
    },
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
