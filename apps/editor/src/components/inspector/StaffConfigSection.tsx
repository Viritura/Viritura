import { useState, type CSSProperties } from "react";
import { Button, FormInput } from "@viritura/ui";
import { labelStyle, legendStyle, sectionStyle } from "./types";

const CONTROL_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: "0.5rem" };
const INPUT_STYLE: CSSProperties = { width: "4.5rem" };
const HINT_STYLE: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
  lineHeight: 1.4,
};

interface StaffConfigSectionProps {
  lines: number;
  staff: number;
  measureNumber: number;
  hasExplicitChange: boolean;
  onLinesChange: (lines: number) => void;
  onClear: () => void;
}

export function StaffConfigSection({
  lines,
  staff,
  measureNumber,
  hasExplicitChange,
  onLinesChange,
  onClear,
}: StaffConfigSectionProps) {
  const [draft, setDraft] = useState(String(lines));
  const commitDraft = () => {
    if (draft.trim() === "") {
      setDraft(String(lines));
      return;
    }
    const value = Number(draft);
    if (Number.isSafeInteger(value) && value >= 0) onLinesChange(value);
    else setDraft(String(lines));
  };

  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Staff</legend>
      <label style={labelStyle}>
        Number of lines
        <div style={CONTROL_ROW_STYLE}>
          <FormInput
            aria-label="Number of staff lines"
            type="number"
            min={0}
            step={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitDraft();
            }}
            style={INPUT_STYLE}
          />
          {hasExplicitChange && <Button size="sm" label="Use inherited" onClick={onClear} />}
        </div>
      </label>
      <span style={HINT_STYLE}>
        Staff {staff}, from measure {measureNumber}. Zero hides all staff lines.
      </span>
    </fieldset>
  );
}
