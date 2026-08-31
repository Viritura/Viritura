import type { CSSProperties } from "react";
import { sectionStyle, legendStyle, labelStyle, errorStyle } from "./types";
import { Button, FormInput, Select } from "@viritura/ui";

const SWATCH_ROW_STYLE: CSSProperties = { display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "0.3rem" };
const COLOR_INPUT_ERROR_STYLE: CSSProperties = { boxShadow: "var(--inset-soft), inset 0 0 0 1px var(--error)" };
function colorInputStyle(hasError: boolean): CSSProperties | undefined {
  return hasError ? COLOR_INPUT_ERROR_STYLE : undefined;
}
function swatchBackgroundStyle(swatch: string): CSSProperties {
  return { ...swatchButtonStyle, background: swatch };
}
import type { ColorTarget } from "../../commands/colorCommands";
import { COLOR_SWATCHES } from "./notationInspectorMeta";

const COLOR_TARGET_OPTIONS = [
  { value: "clef", label: "Clef" },
  { value: "key", label: "Key" },
  { value: "ending", label: "Ending" },
  { value: "grace", label: "Grace" },
  { value: "segno", label: "Segno" },
  { value: "fine", label: "Fine" },
  { value: "coda", label: "Coda" },
] as const;

const swatchButtonStyle = {
  width: "22px",
  height: "22px",
  border: "1px solid rgba(20, 20, 28, 0.15)",
  borderRadius: "6px",
  boxShadow: "0 1px 2px rgba(20, 20, 28, 0.08)",
  cursor: "pointer",
  padding: 0,
} as const;

export interface ColorSectionProps {
  disabled: boolean;
  colorTarget: ColorTarget;
  colorInput: string;
  colorError: string | null;
  onColorTargetChange: (target: ColorTarget) => void;
  onColorInputChange: (value: string) => void;
  onApplyColor: (value: string) => void;
}

export function ColorSection({
  disabled,
  colorTarget,
  colorInput,
  colorError,
  onColorTargetChange,
  onColorInputChange,
  onApplyColor,
}: ColorSectionProps) {
  return (
    <fieldset style={sectionStyle} disabled={disabled}>
      <legend style={legendStyle}>Color</legend>
      <label style={labelStyle}>
        Target
        <Select
          value={colorTarget}
          onValueChange={(v) => onColorTargetChange(v as ColorTarget)}
          options={[...COLOR_TARGET_OPTIONS]}
        />
      </label>
      <label style={labelStyle}>
        Hex
        <FormInput
          value={colorInput}
          onChange={(e) => onColorInputChange(e.target.value)}
          onBlur={() => onApplyColor(colorInput)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onApplyColor(colorInput);
            }
          }}
          placeholder="#RRGGBB"
          style={colorInputStyle(colorError !== null)}
        />
      </label>
      <div style={SWATCH_ROW_STYLE}>
        {COLOR_SWATCHES.map((swatch) => (
          <Button
            key={swatch}
            size="sm"
            onClick={() => onApplyColor(swatch)}
            tooltip={`Apply ${swatch}`}
            style={swatchBackgroundStyle(swatch)}
          />
        ))}
      </div>
      {colorError && <div style={errorStyle}>{colorError}</div>}
    </fieldset>
  );
}
