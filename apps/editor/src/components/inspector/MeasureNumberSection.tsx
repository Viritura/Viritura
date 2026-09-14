import { useState, type CSSProperties } from "react";
import { Button, FormInput } from "@viritura/ui";
import { errorStyle, labelStyle, legendStyle, sectionStyle } from "./types";

const CONTROL_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: "0.4rem" };
const INPUT_STYLE: CSSProperties = { width: "5rem" };

export interface MeasureNumberSectionProps {
  measureIndex: number;
  value: number | undefined;
  error: string | null;
  onChange: (value: string) => void;
}

export function MeasureNumberSection({ measureIndex, value, error, onChange }: MeasureNumberSectionProps) {
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));

  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Measure number</legend>
      <div style={labelStyle}>
        <span>Override</span>
        <div style={CONTROL_STYLE}>
          <FormInput
            aria-label={`Measure ${measureIndex + 1} number override`}
            type="number"
            min={1}
            step={1}
            value={draft}
            placeholder={String(measureIndex + 1)}
            onChange={(event) => setDraft(event.target.value)}
            style={INPUT_STYLE}
          />
          <Button size="sm" label="Apply" onClick={() => onChange(draft)} />
          {value !== undefined && (
            <Button
              size="sm"
              label="Clear override"
              onClick={() => {
                setDraft("");
                onChange("");
              }}
            />
          )}
        </div>
      </div>
      {error && <span style={errorStyle}>{error}</span>}
    </fieldset>
  );
}
