import type { GroupingDisplay } from "@viritura/core";
import { ButtonGroup } from "@viritura/ui";
import { sectionStyle, legendStyle, labelStyle } from "./types";
import type { GroupingDisplayInspectorState } from "./useGroupingDisplayInspector";

type OverrideValue = "auto" | GroupingDisplay;

const OPTIONS: { value: OverrideValue; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "standard", label: "Standard" },
  { value: "additive", label: "Additive" },
  { value: "annotation", label: "Annotation" },
];

function toOverrideValue(mode: GroupingDisplay | undefined): OverrideValue {
  return mode ?? "auto";
}

function fromOverrideValue(value: OverrideValue): GroupingDisplay | null {
  return value === "auto" ? null : value;
}

export interface GroupingDisplaySectionProps {
  state: GroupingDisplayInspectorState;
}

/**
 * Occurrence and per-staff grouping-display overrides for the meter in
 * force at the current selection. "Auto" clears the override, falling back
 * to the next level of the cascade (time occurrence → house style for
 * non-default grouping → standard). This edits presentation only — the
 * semantic beat grouping automatic beaming reads never changes here.
 */
export function GroupingDisplaySection({ state }: GroupingDisplaySectionProps) {
  if (!state.isAvailable) return null;
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Meter grouping display</legend>
      <label style={labelStyle}>
        This time signature
        <ButtonGroup<OverrideValue>
          options={OPTIONS}
          value={toOverrideValue(state.occurrenceOverride)}
          onChange={(value) => state.handleSetOccurrenceOverride(fromOverrideValue(value))}
        />
      </label>
      {state.staff !== undefined && (
        <label style={labelStyle}>
          {`${state.staffLabel ?? `Staff ${state.staff}`} only`}
          <ButtonGroup<OverrideValue>
            options={OPTIONS}
            value={toOverrideValue(state.staffOverride)}
            onChange={(value) => state.handleSetStaffOverride(fromOverrideValue(value))}
          />
        </label>
      )}
    </fieldset>
  );
}
