import { useMemo } from "react";
import type { Fermata, FermataDuration, FermataSymbol, Orientation } from "@viritura/core";
import { Select } from "@viritura/ui";
import { resolveNotationSelectionTarget, setFermataProperties } from "../../commands/notationInspectorCommands";
import { useDocument, useDocumentActions } from "../../store/DocumentContext";
import { useSelection, useSelectedElementType } from "../../store/selectionStore";
import { useViewStateStore } from "../../store/viewStateStore";
import { useNotationInspectorSelection } from "./useNotationInspectorSelection";
import { labelStyle, legendStyle, sectionStyle } from "./types";

const SYMBOL_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "angled", label: "Angled (short)" },
  { value: "square", label: "Square (long)" },
  { value: "doubleAngled", label: "Double angled (very short)" },
  { value: "doubleSquare", label: "Double square (very long)" },
  { value: "doubleDot", label: "Double dot (long, Henze)" },
  { value: "halfCurve", label: "Half curve (short, Henze)" },
  { value: "curlew", label: "Curlew" },
] as const;

const DURATION_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "none", label: "None" },
  { value: "veryShort", label: "Very short" },
  { value: "short", label: "Short" },
  { value: "normal", label: "Normal" },
  { value: "long", label: "Long" },
  { value: "veryLong", label: "Very long" },
] as const;

const ORIENTATION_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "above", label: "Above" },
  { value: "below", label: "Below" },
] as const;

export function FermataSection() {
  const selection = useSelection();
  const selectedElementType = useSelectedElementType();
  const { score } = useDocument();
  const { updateScore } = useDocumentActions();
  const selectedScoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const target = useMemo(() => (score ? resolveNotationSelectionTarget(selection, score) : null), [score, selection]);
  const { selectedFermata: fermata } = useNotationInspectorSelection(selection, score, target);
  if (selectedElementType !== "fermata" || !fermata || !score || !target) return null;

  const updateFermata = (patch: Partial<Pick<Fermata, "symbol" | "duration" | "orient">>) => {
    const result = setFermataProperties(score, target, patch, selectedScoreIndex);
    if (result.score) updateScore(result.score);
  };

  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Fermata</legend>
      <label style={labelStyle}>
        Symbol
        <Select
          data-testid="notation-fermata-symbol"
          value={fermata.symbol ?? "normal"}
          options={SYMBOL_OPTIONS}
          onValueChange={(value) => updateFermata({ symbol: value as FermataSymbol })}
        />
      </label>
      <label style={labelStyle}>
        Duration
        <Select
          data-testid="notation-fermata-duration"
          value={fermata.duration ?? "auto"}
          options={DURATION_OPTIONS}
          onValueChange={(value) => updateFermata({ duration: value as FermataDuration })}
        />
      </label>
      <label style={labelStyle}>
        Orientation
        <Select
          data-testid="notation-fermata-orientation"
          value={fermata.orient ?? "auto"}
          options={ORIENTATION_OPTIONS}
          onValueChange={(value) => updateFermata({ orient: value as Orientation })}
        />
      </label>
    </fieldset>
  );
}
