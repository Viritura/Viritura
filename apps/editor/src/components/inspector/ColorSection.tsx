import type { CSSProperties } from "react";
import { sectionStyle, legendStyle, labelStyle, errorStyle } from "./types";
import { Button, FormInput } from "@viritura/ui";
import { useDebouncedInput } from "../../hooks/useDebouncedInput";

const COLOR_INPUT_ERROR_STYLE: CSSProperties = { boxShadow: "var(--inset-soft), inset 0 0 0 1px var(--error)" };
const NATIVE_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const COLOR_CONTROL_ROW_STYLE: CSSProperties = { display: "grid", gridTemplateColumns: "44px 1fr", gap: "8px" };
const NATIVE_COLOR_INPUT_STYLE: CSSProperties = {
  width: "44px",
  height: "32px",
  padding: "2px",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--surface)",
  cursor: "pointer",
};
const COLOR_DESCRIPTION_STYLE: CSSProperties = {
  margin: 0,
  color: "var(--text-muted)",
  fontSize: "0.75rem",
};
function colorInputStyle(hasError: boolean): CSSProperties | undefined {
  return hasError ? COLOR_INPUT_ERROR_STYLE : undefined;
}

export interface ColorSectionProps {
  disabled: boolean;
  targetLabel: string;
  colorInput: string;
  colorError: string | null;
  onColorInputChange: (value: string) => void;
  onApplyColor: (value: string | null) => void;
}

export function ColorSection({
  disabled,
  targetLabel,
  colorInput,
  colorError,
  onColorInputChange,
  onApplyColor,
}: ColorSectionProps) {
  const picker = useDebouncedInput(colorInput, onApplyColor, 150);

  return (
    <fieldset style={sectionStyle} disabled={disabled}>
      <legend style={legendStyle}>Color</legend>
      <p style={COLOR_DESCRIPTION_STYLE}>Applies to the selected {targetLabel}.</p>
      <label style={labelStyle}>
        Color
        <div style={COLOR_CONTROL_ROW_STYLE}>
          <FormInput
            aria-label={`Choose color for selected ${targetLabel}`}
            type="color"
            value={NATIVE_COLOR_RE.test(picker.value) ? picker.value : "#000000"}
            onChange={(event) => {
              picker.onChange(event.target.value);
              onColorInputChange(event.target.value);
            }}
            onBlur={picker.onBlur}
            style={NATIVE_COLOR_INPUT_STYLE}
          />
          <FormInput
            aria-label="Hex color"
            value={colorInput}
            onChange={(e) => {
              picker.reset();
              onColorInputChange(e.target.value);
            }}
            onBlur={() => onApplyColor(colorInput)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                picker.reset();
                onApplyColor(colorInput);
              }
            }}
            placeholder="#RRGGBB"
            style={colorInputStyle(colorError !== null)}
          />
        </div>
      </label>
      <Button
        size="sm"
        onClick={() => {
          picker.reset();
          onApplyColor(null);
        }}
      >
        Reset to default
      </Button>
      {colorError && <div style={errorStyle}>{colorError}</div>}
    </fieldset>
  );
}
