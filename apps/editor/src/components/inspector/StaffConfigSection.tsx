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
  lines: number | null;
  staff: number;
  startMeasureNumber: number;
  endMeasureNumber: number;
  maxLines: number;
  origin: "default" | "inherited" | "explicit";
  hasChangesInSelection: boolean;
  onLinesChange: (lines: number) => void;
  onClear: () => void;
}

function lineCountLabel(lines: number): string {
  return `${lines} ${lines === 1 ? "line" : "lines"}`;
}

function describeState(lines: number | null, origin: StaffConfigSectionProps["origin"]): string {
  if (lines === null) return "Mixed line counts";
  if (origin === "explicit") return `Explicit change: ${lineCountLabel(lines)}`;
  if (origin === "inherited") return `Inherited from an earlier change: ${lineCountLabel(lines)}`;
  return `Score default: ${lineCountLabel(lines)}`;
}

export function StaffConfigSection({
  lines,
  staff,
  startMeasureNumber,
  endMeasureNumber,
  maxLines,
  origin,
  hasChangesInSelection,
  onLinesChange,
  onClear,
}: StaffConfigSectionProps) {
  const [draft, setDraft] = useState(lines === null ? "" : String(lines));
  const isRange = startMeasureNumber !== endMeasureNumber;
  const commitDraft = () => {
    if (draft.trim() === "") {
      setDraft(lines === null ? "" : String(lines));
      return;
    }
    const value = Number(draft);
    if (Number.isSafeInteger(value) && value >= 0) onLinesChange(value);
    else setDraft(lines === null ? "" : String(lines));
  };
  const status = describeState(lines, origin);

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
            max={maxLines}
            step={1}
            value={draft}
            placeholder={lines === null ? "Mixed" : undefined}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitDraft();
            }}
            style={INPUT_STYLE}
          />
          {hasChangesInSelection && (
            <Button size="sm" label={isRange ? "Remove selected changes" : "Remove change"} onClick={onClear} />
          )}
        </div>
      </label>
      <span style={HINT_STYLE}>
        {status}. Staff {staff},{" "}
        {isRange
          ? `bars ${startMeasureNumber}-${endMeasureNumber}; changes apply only to this selection`
          : `from bar ${startMeasureNumber} until the next staff-line change`}
        . Zero hides all staff lines; the editor supports up to {maxLines}.
      </span>
    </fieldset>
  );
}
