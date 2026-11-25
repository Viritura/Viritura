import { useMemo } from "react";
import type { Fermata, FermataDuration, FermataSymbol, Placement } from "@viritura/core";
import { FormInput, Select } from "@viritura/ui";
import { resolveNotationSelectionTarget, setFermataProperties } from "../../commands/notationInspectorCommands";
import { useDocument, useDocumentActions } from "../../store/DocumentContext";
import { useSelection, useSelectedElementType } from "../../store/selectionStore";
import { useViewStateStore } from "../../store/viewStateStore";
import { useNotationInspectorSelection } from "./useNotationInspectorSelection";
import { labelStyle, legendStyle, sectionStyle } from "./types";
import { resolveGlobalFermata } from "../../score/ElementPath";
import type { GlobalFermata } from "@viritura/core";

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

const PLACEMENT_OPTIONS = [
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
  const global = score && selection.kind === "single" ? resolveGlobalFermata(selection.elementId, score) : null;
  if (selectedElementType === "fermata" && global && score) {
    const updateGlobal = (patch: Partial<Pick<GlobalFermata, "multiplier" | "clickBehavior">>) => {
      const next = structuredClone(score);
      const item = next.global.measures[global.measureIndex]!.fermatas!.find(
        (value) => value.id === global.fermata.id,
      )!;
      Object.assign(item, patch);
      updateScore(next);
    };
    return (
      <fieldset style={sectionStyle}>
        <legend style={legendStyle}>Fermata</legend>
        <p>Applies to all staves.</p>
        <label style={labelStyle}>
          Duration multiplier
          <FormInput
            data-testid="notation-fermata-multiplier"
            type="number"
            min={1}
            step={0.25}
            value={global.fermata.multiplier ?? 2}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value >= 1) updateGlobal({ multiplier: value });
            }}
          />
        </label>
        <label style={labelStyle}>
          Click during hold
          <Select
            data-testid="notation-fermata-click"
            value={global.fermata.clickBehavior ?? "silent"}
            options={[
              { value: "silent", label: "Silent" },
              { value: "keepClicking", label: "Keep clicking" },
            ]}
            onValueChange={(value) => updateGlobal({ clickBehavior: value as GlobalFermata["clickBehavior"] })}
          />
        </label>
      </fieldset>
    );
  }
  if (selectedElementType !== "fermata" || !fermata || !score || !target) return null;

  const updateFermata = (patch: Partial<Pick<Fermata, "symbol" | "duration" | "placement">>) => {
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
        Placement
        <Select
          data-testid="notation-fermata-placement"
          value={fermata.placement ?? "auto"}
          options={PLACEMENT_OPTIONS}
          onValueChange={(value) => updateFermata({ placement: value as Placement })}
        />
      </label>
    </fieldset>
  );
}
