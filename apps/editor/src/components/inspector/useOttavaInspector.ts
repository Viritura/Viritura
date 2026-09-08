import { useCallback, useMemo } from "react";
import type { Orientation, Ottava, Score } from "@viritura/core";
import { produce } from "../../score/scoreClone";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";

interface OttavaInspectorArgs {
  score: Score | null;
  target: NotationSelectionTarget | null;
  updateScore: (score: Score) => void;
}

export interface OttavaInspectorState {
  ottava: Ottava;
  staffCount: number;
  voiceOptions: readonly string[];
  onValueChange: (value: number) => void;
  onOrientationChange: (value: Orientation | undefined) => void;
  onStaffChange: (value: number | undefined) => void;
  onVoiceChange: (value: string) => void;
}

export function useOttavaInspector({ score, target, updateScore }: OttavaInspectorArgs): OttavaInspectorState | null {
  const ottavaIndex = target?.elementType.match(/^ottava(\d+)$/)?.[1];
  const ottava = useMemo(() => {
    if (!score || !target || ottavaIndex === undefined) return null;
    return score.parts[target.partIndex]?.measures[target.measureIndex]?.ottavas?.[Number(ottavaIndex)] ?? null;
  }, [ottavaIndex, score, target]);

  const mutateOttava = useCallback(
    (mutate: (ottava: Ottava) => void) => {
      if (!score || !target || ottavaIndex === undefined) return;
      const nextScore = produce(score, (draft) => {
        const selected = draft.parts[target.partIndex]?.measures[target.measureIndex]?.ottavas?.[Number(ottavaIndex)];
        if (selected) mutate(selected);
      });
      if (nextScore !== score) updateScore(nextScore);
    },
    [ottavaIndex, score, target, updateScore],
  );

  if (!score || !target || !ottava) return null;
  const sequences = score.parts[target.partIndex]?.measures[target.measureIndex]?.sequences ?? [];
  const voices = sequences.map((sequence, index) => sequence.voice ?? (sequences.length > 1 ? `v${index + 1}` : ""));
  return {
    ottava,
    staffCount: score.parts[target.partIndex]?.staves ?? 1,
    voiceOptions: Array.from(new Set([...(ottava.voice ? [ottava.voice] : []), ...voices.filter(Boolean)])),
    onValueChange: (value) => mutateOttava((selected) => void (selected.value = value)),
    onOrientationChange: (value) =>
      mutateOttava((selected) => {
        selected.orient = value;
      }),
    onStaffChange: (value) =>
      mutateOttava((selected) => {
        selected.staff = value;
      }),
    onVoiceChange: (value) =>
      mutateOttava((selected) => {
        selected.voice = value || undefined;
      }),
  };
}
