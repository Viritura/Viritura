import { Button, Select, type SelectOption } from "@viritura/ui";
import { labelStyle, legendStyle, sectionStyle } from "./types";
import type { TimeSignatureDisplayValue } from "./useTimeSignatureInspector";

export interface TimeSignatureSectionProps {
  count: number;
  unit: number;
  display: TimeSignatureDisplayValue;
  onDisplayChange: (display: TimeSignatureDisplayValue) => void;
  onRemove: () => void;
}

export function TimeSignatureSection({ count, unit, display, onDisplayChange, onRemove }: TimeSignatureSectionProps) {
  const options: SelectOption[] = [
    { value: "numeric", label: "Stacked numbers" },
    { value: "common", label: "Common time", disabled: count !== 4 || unit !== 4 },
    { value: "cut", label: "Cut time", disabled: count !== 2 || unit !== 2 },
    { value: "senzaMisura", label: "Open meter" },
    { value: "note", label: "Note-value denominator" },
  ];

  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Time signature</legend>
      <div style={labelStyle}>
        <span>Display</span>
        <Select
          aria-label="Time signature display"
          value={display}
          options={options}
          onValueChange={(value) => onDisplayChange(value as TimeSignatureDisplayValue)}
        />
      </div>
      <Button size="sm" label="Remove time signature" onClick={onRemove} />
    </fieldset>
  );
}
