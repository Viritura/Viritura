import { useState, type CSSProperties } from "react";
import type { StaffMeterSynchronization } from "@viritura/core";
import { Button, ButtonGroup, FormInput, Select, type SelectOption } from "@viritura/ui";
import { errorStyle, labelStyle, legendStyle, sectionStyle } from "./types";
import type { StaffMeterInspectorState } from "./useStaffMeterInspector";

const CONTROL_ROW_STYLE: CSSProperties = { display: "flex", alignItems: "center", gap: "0.5rem" };
const COUNT_INPUT_STYLE: CSSProperties = { width: "3.5rem" };
const HINT_STYLE: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--type-eyebrow-size)",
  lineHeight: 1.4,
};

const UNIT_OPTIONS: SelectOption[] = [1, 2, 4, 8, 16, 32, 64, 128].map((unit) => ({
  value: String(unit),
  label: String(unit),
}));

const SYNCHRONIZATION_OPTIONS: { value: StaffMeterSynchronization; label: string }[] = [
  { value: "sharedDuration", label: "Shared duration" },
  { value: "fitMeasure", label: "Fit measure" },
];

function formatMeter(count: number, unit: number): string {
  return `${count}/${unit}`;
}

function formatRatio(num: number, den: number): string {
  return den === 1 ? `${num}` : `${num}/${den}`;
}

export interface StaffMeterSectionProps {
  state: StaffMeterInspectorState;
}

/**
 * Staff-local synchronous meter authoring for the selected staff at the
 * current measure (`_x.viritura.staffMeters`). Lets a musician give one
 * staff its own time signature while every staff's barlines stay locked to
 * the shared global measure grid — non-aligning/independent polymeter is
 * out of scope. See `docs/spec/viritura-extensions.md#staffmeters`.
 */
export function StaffMeterSection({ state }: StaffMeterSectionProps) {
  const { effective } = state;
  const [count, setCount] = useState(String(effective?.timeSignature.count ?? 6));
  const [unit, setUnit] = useState(String(effective?.timeSignature.unit ?? 8));
  const [synchronization, setSynchronization] = useState<StaffMeterSynchronization>(
    effective?.synchronization ?? "sharedDuration",
  );

  if (!state.isAvailable || state.staff === undefined) return null;

  const globalLabel = formatMeter(state.globalTimeSignature.count, state.globalTimeSignature.unit);
  const statusLabel = effective
    ? `${formatMeter(effective.timeSignature.count, effective.timeSignature.unit)} (${
        effective.synchronization === "fitMeasure" ? "fit measure" : "shared duration"
      }${
        effective.synchronization === "fitMeasure"
          ? `, ratio ${formatRatio(effective.ratioToGlobal.num, effective.ratioToGlobal.den)}`
          : ""
      })`
    : `Global (${globalLabel})`;

  const applyStaffMeter = () => {
    const parsedCount = Number(count);
    const parsedUnit = Number(unit);
    if (!Number.isInteger(parsedCount) || parsedCount < 1) return;
    state.handleSetStaffMeter({ count: parsedCount, unit: parsedUnit }, synchronization);
  };

  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Staff-local meter</legend>
      <span style={HINT_STYLE}>{`${state.staffLabel ?? `Staff ${state.staff}`}: ${statusLabel}`}</span>
      {state.issue && <span style={errorStyle}>{state.issue.error.message}</span>}
      <label style={labelStyle}>
        Meter
        <div style={CONTROL_ROW_STYLE}>
          <FormInput
            aria-label="Staff-local meter count"
            type="number"
            min={1}
            step={1}
            value={count}
            onChange={(event) => setCount(event.target.value)}
            style={COUNT_INPUT_STYLE}
          />
          <span aria-hidden="true">/</span>
          <Select aria-label="Staff-local meter unit" value={unit} onValueChange={setUnit} options={UNIT_OPTIONS} />
        </div>
      </label>
      <label style={labelStyle}>
        Synchronization
        <ButtonGroup<StaffMeterSynchronization>
          options={SYNCHRONIZATION_OPTIONS}
          value={synchronization}
          onChange={setSynchronization}
        />
      </label>
      <div style={CONTROL_ROW_STYLE}>
        <Button size="sm" label="Apply to this staff" onClick={applyStaffMeter} />
        {effective && <Button size="sm" label="Reset to global" onClick={state.handleResetToGlobal} />}
      </div>
      <span style={HINT_STYLE}>
        {"Shared duration requires this staff's measure duration to equal the global measure's; " +
          "fit measure maps one complete local measure onto one complete global measure by a derived ratio."}
      </span>
    </fieldset>
  );
}
