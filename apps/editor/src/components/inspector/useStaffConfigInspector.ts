import { useCallback, useMemo } from "react";
import type { Score, ScorePatch } from "@viritura/core";
import type { Selection } from "../../store/selectionStore";
import {
  planClearStaffLineCount,
  planSetStaffLineCount,
  readStaffLineConfig,
  resolveStaffConfigSelectionTarget,
} from "../../commands/staffConfigCommands";

interface UseStaffConfigInspectorArgs {
  score: Score | null;
  selection: Selection;
  commitPatches: (patches: readonly ScorePatch[]) => void;
}

export function useStaffConfigInspector({ score, selection, commitPatches }: UseStaffConfigInspectorArgs) {
  const target = useMemo(
    () => (score ? resolveStaffConfigSelectionTarget(selection, score) : null),
    [score, selection],
  );
  const state = useMemo(() => (score && target ? readStaffLineConfig(score, target) : null), [score, target]);

  const setLines = useCallback(
    (lines: number) => {
      if (!score || !target) return;
      commitPatches(planSetStaffLineCount(score, target, lines));
    },
    [commitPatches, score, target],
  );

  const clear = useCallback(() => {
    if (!score || !target) return;
    commitPatches(planClearStaffLineCount(score, target));
  }, [commitPatches, score, target]);

  return {
    target,
    lines: state?.lines ?? 5,
    hasExplicitChange: state?.hasExplicitChange ?? false,
    setLines,
    clear,
  };
}
