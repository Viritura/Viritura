import { useCallback, useMemo } from "react";
import type { LyricLineType, Score } from "@viritura/core";
import {
  moveLyricToLine,
  resolveSelectedLyric,
  setLyricSyllabicType,
  setLyricText,
} from "../../commands/lyricCommands";
import { getLyricLineDisplay, getLyricLineIds } from "../../lyrics";
import { getEventAncestorId, lyricElementId } from "../../score/ElementPath";
import type { SelectionState } from "../../store/selectionStore";
import { useSelectionActions } from "../../store/selectionStore";

interface UseLyricInspectorOptions {
  score: Score | null;
  selection: SelectionState;
  updateScore: (score: Score) => void;
}

export function useLyricInspector({ score, selection, updateScore }: UseLyricInspectorOptions) {
  const { selectElement } = useSelectionActions();
  const elementId = selection.kind === "single" ? selection.elementId : null;
  const selected = useMemo(
    () => (score && elementId ? resolveSelectedLyric(score, elementId) : null),
    [elementId, score],
  );
  const lineOptions = useMemo(() => {
    if (!score || !selected) return [];
    return getLyricLineIds(score).map((lineId) => ({
      value: lineId,
      label: getLyricLineDisplay(score, lineId),
      disabled: lineId !== selected.lineId && selected.occupiedLineIds.includes(lineId),
    }));
  }, [score, selected]);

  const update = useCallback(
    (next: Score | null) => {
      if (next) updateScore(next);
    },
    [updateScore],
  );
  const handleTextChange = useCallback(
    (text: string) => {
      if (score && elementId) update(setLyricText(score, elementId, text));
    },
    [elementId, score, update],
  );
  const handleSyllabicTypeChange = useCallback(
    (type: LyricLineType) => {
      if (score && elementId) update(setLyricSyllabicType(score, elementId, type));
    },
    [elementId, score, update],
  );
  const handleLineChange = useCallback(
    (lineId: string) => {
      if (!score || !elementId || !selected) return;
      const next = moveLyricToLine(score, elementId, lineId);
      if (!next) return;
      updateScore(next);
      selectElement(lyricElementId(getEventAncestorId(elementId), lineId));
    },
    [elementId, score, selectElement, selected, updateScore],
  );

  return {
    selected,
    lineOptions,
    handleTextChange,
    handleSyllabicTypeChange,
    handleLineChange,
  };
}
