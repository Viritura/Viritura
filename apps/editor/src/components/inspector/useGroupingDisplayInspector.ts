import { useCallback } from "react";
import type { GroupingDisplay, Score, TimeSignature } from "@viritura/core";
import { setGroupingDisplayOverride, setTimeSignature } from "@viritura/core";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { staffFromSelection } from "../../app/useSignatureActions";
import type { SelectionState } from "../../store/selectionStore";

/**
 * The time signature in force at `measureIndex` — the nearest explicit
 * `time` at or before it, or the engine's 4/4 default. Mirrors
 * `useSignatureActions`'s helper of the same name so both the palette's
 * whole-time-signature edits and the inspector's occurrence-only edits agree
 * on what "the current meter" means.
 */
function effectiveTimeSignatureAt(score: Score, measureIndex: number): TimeSignature {
  for (let i = measureIndex; i >= 0; i--) {
    const time = score.global.measures[i]?.time;
    if (time) return time;
  }
  return { count: 4, unit: 4 };
}

export interface GroupingDisplayInspectorDeps {
  score: Score | null;
  /** The inspector's resolved selection target — see `resolveNotationSelectionTarget`.
   *  Global elements like a time signature resolve `measureIndex`/`partIndex` even
   *  though their element ID carries no part segment. */
  target: NotationSelectionTarget | null;
  selection: SelectionState;
  updateScore: (score: Score) => void;
}

export interface GroupingDisplayInspectorState {
  /** False when the selection has no resolvable measure scope. */
  isAvailable: boolean;
  /** The time signature's own occurrence override, or `undefined` when unset ("Auto"). */
  occurrenceOverride: GroupingDisplay | undefined;
  /** 1-based staff number a per-staff override would target, if resolvable from the selection. */
  staff: number | undefined;
  /** The per-staff override for `staff`, or `undefined` when unset ("Auto"). */
  staffOverride: GroupingDisplay | undefined;
  handleSetOccurrenceOverride: (mode: GroupingDisplay | null) => void;
  handleSetStaffOverride: (mode: GroupingDisplay | null) => void;
}

/**
 * Occurrence- and staff-level grouping-display overrides for the meter at
 * the current selection. Presentation-only — never touches the semantic
 * `beatStructure` automatic beaming reads. See
 * `docs/spec/viritura-extensions.md` for the full cascade
 * (staff > time occurrence > house style for non-default grouping > standard).
 */
export function useGroupingDisplayInspector({
  score,
  target,
  selection,
  updateScore,
}: GroupingDisplayInspectorDeps): GroupingDisplayInspectorState {
  const measureIndex = target?.measureIndex ?? 0;
  const partIndex = target?.partIndex ?? 0;
  const staff = staffFromSelection(selection);

  const occurrenceOverride =
    score && target ? effectiveTimeSignatureAt(score, measureIndex).groupingDisplay : undefined;
  const staffOverride =
    staff !== undefined
      ? score?.parts[partIndex]?.measures[measureIndex]?.groupingDisplayOverrides?.find((o) => o.staff === staff)
          ?.groupingDisplay
      : undefined;

  const handleSetOccurrenceOverride = useCallback(
    (mode: GroupingDisplay | null) => {
      if (!score || !target) return;
      const current = effectiveTimeSignatureAt(score, measureIndex);
      const next: TimeSignature = { ...current };
      if (mode) next.groupingDisplay = mode;
      else delete next.groupingDisplay;
      updateScore(setTimeSignature(score, measureIndex, next));
    },
    [score, target, measureIndex, updateScore],
  );

  const handleSetStaffOverride = useCallback(
    (mode: GroupingDisplay | null) => {
      if (!score || !target || staff === undefined) return;
      updateScore(setGroupingDisplayOverride(score, measureIndex, partIndex, staff, mode));
    },
    [score, target, measureIndex, partIndex, staff, updateScore],
  );

  return {
    isAvailable: target !== null,
    occurrenceOverride,
    staff,
    staffOverride,
    handleSetOccurrenceOverride,
    handleSetStaffOverride,
  };
}
