import { useCallback, useMemo } from "react";
import { lyricExtenderTargetCandidates, resolveLyricExtenders } from "@viritura/core";
import type { LyricLineType, Score } from "@viritura/core";
import {
  moveLyricToLine,
  resolveSelectedLyric,
  setLyricExtenderMode,
  setLyricExtenderTarget,
  setLyricSyllabicType,
  setLyricText,
  type LyricExtenderMode,
} from "../../commands/lyricCommands";
import { getLyricLineDisplay, getLyricLineIds } from "../../lyrics";
import {
  getEventAncestorId,
  getEventAtLocation,
  resolveEventFromSubElement,
  lyricElementId,
} from "../../score/ElementPath";
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
  const extenderTargetOptions = useMemo(() => {
    const options = [{ value: "", label: "Infer endpoint" }];
    if (!score || !elementId) return options;
    const location = resolveEventFromSubElement(elementId, score);
    const event = location ? getEventAtLocation(score, location) : null;
    if (event?.type !== "event" || !event.id) return options;
    for (const candidate of lyricExtenderTargetCandidates(score, event.id)) {
      const part = score.parts[candidate.partIndex];
      options.push({
        value: candidate.eventId,
        label: `${part?.name || `Part ${candidate.partIndex + 1}`} · measure ${candidate.measureIndex + 1} · ${candidate.eventId}`,
      });
    }
    const target = selected?.line.extender?.target;
    if (target && !options.some((option) => option.value === target)) {
      options.push({ value: target, label: `Unavailable endpoint · ${target}` });
    }
    return options;
  }, [elementId, score, selected]);
  const extenderDiagnostic = useMemo(() => {
    if (!score || !elementId || !selected || selected.line.extender?.show === false) return undefined;
    const location = resolveEventFromSubElement(elementId, score);
    const event = location ? getEventAtLocation(score, location) : null;
    if (event?.type !== "event") return undefined;
    const diagnostic = resolveLyricExtenders(score).diagnostics.find(
      (issue) =>
        issue.sourceEventId === event.id &&
        issue.lineId === selected.lineId &&
        issue.partIndex === location?.partIndex &&
        issue.measureIndex === location?.measureIndex &&
        issue.sequenceIndex === location?.sequenceIndex,
    );
    if (!diagnostic) return undefined;
    const reasons = {
      "missing-target": "The endpoint no longer exists in this score.",
      "backward-target": "The endpoint is before this syllable.",
      "conflicting-target": "The endpoint crosses another syllable in this lyric line.",
    };
    return `${reasons[diagnostic.code]} Choose another endpoint or clear it to infer the endpoint. The stored target is preserved.`;
  }, [elementId, score, selected]);

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
  const handleExtenderModeChange = useCallback(
    (mode: LyricExtenderMode) => {
      if (score && elementId) update(setLyricExtenderMode(score, elementId, mode));
    },
    [elementId, score, update],
  );
  const handleExtenderTargetChange = useCallback(
    (targetId?: string) => {
      if (score && elementId) update(setLyricExtenderTarget(score, elementId, targetId));
    },
    [elementId, score, update],
  );

  return {
    selected,
    lineOptions,
    extenderTargetOptions,
    extenderDiagnostic,
    handleTextChange,
    handleSyllabicTypeChange,
    handleLineChange,
    handleExtenderModeChange,
    handleExtenderTargetChange,
  };
}
