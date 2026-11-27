import { useCallback, useMemo, useState } from "react";
import type { BeamHookDirection, Score } from "@viritura/core";
import {
  breakBeamAfterAtLevel,
  canBreakBeamAfterAtLevel,
  canJoinBeamAtLevel,
  canSetBeamletDirection,
  getBeamSelectionInfo,
  joinBeamAtLevel,
  setBeamletDirection,
  type BeamletState,
} from "../../commands/beamCommands";
import { produce } from "../../score/scoreClone";
import type { SelectionState } from "../../store/selectionStore";
import { useViewStateStore } from "../../store/viewStateStore";

export type BeamletChoice = "full" | "automatic" | "forward" | "backward";

export interface BeamInspectorState {
  readonly isAvailable: boolean;
  readonly level: number;
  readonly maxLevel: number;
  readonly selectedEventCount: number;
  readonly beamletState: BeamletState | null;
  readonly canJoin: boolean;
  readonly canBreak: boolean;
  readonly canSetFull: boolean;
  readonly canSetAutomatic: boolean;
  readonly canSetForward: boolean;
  readonly canSetBackward: boolean;
  readonly setLevel: (level: number) => void;
  readonly join: () => void;
  readonly breakAfter: () => void;
  readonly setBeamlet: (choice: BeamletChoice) => void;
}

interface BeamInspectorDeps {
  score: Score | null;
  selection: SelectionState;
  updateScore: (score: Score) => void;
}

export function useBeamInspector({ score, selection, updateScore }: BeamInspectorDeps): BeamInspectorState {
  const selectedScoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const [level, setLevel] = useState(1);
  const maximum = useMemo(() => getBeamSelectionInfo(score, selection, 1).maxLevel, [score, selection]);
  const effectiveLevel = Math.min(level, Math.max(1, maximum));
  const info = useMemo(
    () => getBeamSelectionInfo(score, selection, effectiveLevel),
    [score, selection, effectiveLevel],
  );

  const apply = useCallback(
    (command: (draft: Score) => boolean) => {
      if (!score) return;
      let changed = false;
      const next = produce(score, (draft) => {
        changed = command(draft);
      });
      if (changed && next !== score) updateScore(next);
    },
    [score, updateScore],
  );

  const join = useCallback(
    () => apply((draft) => joinBeamAtLevel(draft, selection, effectiveLevel, selectedScoreIndex)),
    [apply, effectiveLevel, selectedScoreIndex, selection],
  );
  const breakAfter = useCallback(
    () => apply((draft) => breakBeamAfterAtLevel(draft, selection, effectiveLevel, selectedScoreIndex)),
    [apply, effectiveLevel, selectedScoreIndex, selection],
  );
  const setBeamlet = useCallback(
    (choice: BeamletChoice) =>
      apply((draft) =>
        setBeamletDirection(
          draft,
          selection,
          effectiveLevel,
          choice === "full" ? null : choice === "forward" ? "right" : choice === "backward" ? "left" : "auto",
          selectedScoreIndex,
        ),
      ),
    [apply, effectiveLevel, selectedScoreIndex, selection],
  );

  const canSet = (direction: BeamHookDirection | null): boolean =>
    canSetBeamletDirection(score, selection, effectiveLevel, direction, selectedScoreIndex);

  return {
    isAvailable: info.isAvailable,
    level: effectiveLevel,
    maxLevel: info.maxLevel,
    selectedEventCount: info.selectedEventCount,
    beamletState: info.beamletState,
    canJoin: canJoinBeamAtLevel(score, selection, effectiveLevel, selectedScoreIndex),
    canBreak: canBreakBeamAfterAtLevel(score, selection, effectiveLevel, selectedScoreIndex),
    canSetFull: canSet(null),
    canSetAutomatic: canSet("auto"),
    canSetForward: canSet("right"),
    canSetBackward: canSet("left"),
    setLevel,
    join,
    breakAfter,
    setBeamlet,
  };
}
