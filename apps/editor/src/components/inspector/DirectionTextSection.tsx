import { FormInput, Checkbox, Button } from "@viritura/ui";
import type { CSSProperties } from "react";
import { sectionStyle, legendStyle, labelStyle } from "./types";

const offsetRowStyle: CSSProperties = { display: "flex", gap: 8 };
const offsetFieldStyle: CSSProperties = { flex: 1 };
const offsetLabelStyle: CSSProperties = { ...labelStyle, ...offsetFieldStyle };
const offsetInputStyle: CSSProperties = { textAlign: "right" };
const resetButtonStyle: CSSProperties = { alignSelf: "flex-start", marginTop: 4 };

/** A [dx, dy] manual position offset, in spatia (sp). */
export interface ManualOffsetControl {
  value: [number, number];
  onChange: (axis: 0 | 1, value: number) => void;
  onReset: () => void;
  /** Optional "avoid collisions" toggle shown beneath the offset fields. */
  avoidCollisions?: { value: boolean; onChange: (avoid: boolean) => void };
}

/** Reusable manual-placement editor (Offset X/Y + Avoid collisions + Reset).
 *  Shared by the dynamic/expression/rehearsal sections and the tempo section. */
export function ManualOffsetFields({ offset }: { offset: ManualOffsetControl }) {
  const hasOffset = Math.abs(offset.value[0]) > 1e-6 || Math.abs(offset.value[1]) > 1e-6;
  return (
    <>
      <div style={offsetRowStyle}>
        <label style={offsetLabelStyle}>
          Offset X (sp, +right)
          <FormInput
            type="number"
            step="0.5"
            style={offsetInputStyle}
            value={String(offset.value[0])}
            onChange={(e) => offset.onChange(0, Number(e.target.value) || 0)}
          />
        </label>
        <label style={offsetLabelStyle}>
          Offset Y (sp, +up)
          <FormInput
            type="number"
            step="0.5"
            style={offsetInputStyle}
            value={String(offset.value[1])}
            onChange={(e) => offset.onChange(1, Number(e.target.value) || 0)}
          />
        </label>
      </div>
      {offset.avoidCollisions && (
        <Checkbox
          label="Avoid collisions"
          checked={offset.avoidCollisions.value}
          onChange={(e) => offset.avoidCollisions!.onChange(e.target.checked)}
        />
      )}
      {hasOffset && (
        <Button variant="link" size="sm" style={resetButtonStyle} onClick={offset.onReset}>
          Reset position
        </Button>
      )}
    </>
  );
}

export interface DirectionTextSectionProps {
  /** Section heading (e.g. "Dynamic", "Expression"). */
  title: string;
  /** Label shown next to the input. */
  label: string;
  /** Current text value. */
  value: string;
  /** Placeholder hint for the input. */
  placeholder: string;
  onChange: (value: string) => void;
  /** Optional manual position offset editor (sp), shown beneath the text. */
  offset?: ManualOffsetControl;
}

/** Notation-properties section for editing the text of a dynamic or expression. */
export function DirectionTextSection({
  title,
  label,
  value,
  placeholder,
  onChange,
  offset,
}: DirectionTextSectionProps) {
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>{title}</legend>
      <label style={labelStyle}>
        {label}
        <FormInput value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      </label>
      {offset && <ManualOffsetFields offset={offset} />}
    </fieldset>
  );
}
