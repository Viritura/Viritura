import { useCallback, useState } from "react";
import type { Score, TupletBracket, TupletDisplaySetting } from "@viritura/core";
import {
  setLayoutOverridesProperties,
  type LayoutOverridesInspectorPatch,
} from "../../commands/notationInspectorCommands";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";

interface UseLayoutOverrideHandlersArgs {
  score: Score | null;
  target: NotationSelectionTarget | null;
  updateScore: (score: Score) => void;
}

/**
 * Bundles the "apply override + set error" handlers used by `LayoutSection`.
 * Extracted so the component itself stays well under the complexity budget.
 */
export function useLayoutOverrideHandlers({ score, target, updateScore }: UseLayoutOverrideHandlersArgs) {
  const [layoutError, setLayoutError] = useState<string | null>(null);

  const applyOverride = useCallback(
    (patch: LayoutOverridesInspectorPatch, errorMsg: string) => {
      if (!score || !target) return;
      const result = setLayoutOverridesProperties(score, target, patch);
      if (!result.ok || !result.score) {
        setLayoutError(result.error ?? errorMsg);
        return;
      }
      setLayoutError(null);
      updateScore(result.score);
    },
    [score, target, updateScore],
  );

  return {
    layoutError,
    handleStemDirectionChange: (value: string) =>
      applyOverride(
        { event: { stemDirection: value === "" ? null : (value as "up" | "down" | "auto") } },
        "Unable to update stem direction.",
      ),
    handleEventOrientChange: (value: string) =>
      applyOverride(
        { event: { orient: value === "" ? null : (value as "up" | "down") } },
        "Unable to update event orient.",
      ),
    handleEventStaffChange: (value: string) =>
      applyOverride(
        { event: { staff: value === "" ? null : Number.parseInt(value, 10) } },
        "Unable to update cross-staff.",
      ),
    handleSequenceOrientChange: (value: string) =>
      applyOverride(
        { sequence: { orient: value === "" ? null : (value as "up" | "down") } },
        "Unable to update sequence orient.",
      ),
    handleTupletOrientChange: (value: string) =>
      applyOverride(
        { tuplet: { orient: value === "" ? null : (value as "up" | "down") } },
        "Unable to update tuplet orient.",
      ),
    handleTupletBracketChange: (value: string) =>
      applyOverride(
        { tuplet: { bracket: value === "" ? null : (value as TupletBracket) } },
        "Unable to update tuplet bracket.",
      ),
    handleTupletShowNumberChange: (value: string) =>
      applyOverride(
        { tuplet: { showNumber: value === "" ? null : (value as TupletDisplaySetting) } },
        "Unable to update tuplet show number.",
      ),
    handleTupletShowValueChange: (value: string) =>
      applyOverride(
        { tuplet: { showValue: value === "" ? null : (value as TupletDisplaySetting) } },
        "Unable to update tuplet show value.",
      ),
  };
}
