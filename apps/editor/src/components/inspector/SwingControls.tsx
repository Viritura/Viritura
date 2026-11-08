import { useState } from "react";
import { Info } from "lucide-react";
import type { ResolvedTempoSwing, Swing } from "@viritura/core";
import { ButtonGroup, FormField, FormInput, IconButton, SectionLabel, Select } from "@viritura/ui";
import { useDebouncedInput } from "../../hooks/useDebouncedInput";
import styles from "./TempoSection.module.css";

interface SwingControlsProps {
  swing?: Swing;
  effective?: ResolvedTempoSwing;
  onChange: (swing: Swing | undefined) => void;
}

const MODES = [
  { value: "inherit", label: "Inherit" },
  { value: "straight", label: "Straight" },
  { value: "swing", label: "Swing" },
];
const SUBDIVISIONS = [
  { value: "eighth", label: "Eighth" },
  { value: "16th", label: "Sixteenth" },
];
const RATIO_OPTIONS = [
  { value: "3:2", label: "3:2 (60%)" },
  { value: "2:1", label: "2:1 (triplet)" },
  { value: "custom", label: "Custom" },
];

function ratioPreset(ratio: [number, number]): "3:2" | "2:1" | "custom" {
  if (ratio[0] === 3 && ratio[1] === 2) return "3:2";
  if (ratio[0] === 2 && ratio[1] === 1) return "2:1";
  return "custom";
}

export function SwingControls({ swing, effective, onChange }: SwingControlsProps) {
  const [error, setError] = useState("");
  const [customEditing, setCustomEditing] = useState(false);
  const selected = swing?.mode === "swing" ? swing : undefined;
  const ratio = useDebouncedInput(selected ? selected.ratio.join(":") : "3:2", (text) => {
    const match = /^([1-9]\d*):([1-9]\d*)$/.exec(text.trim());
    const first = Number(match?.[1]);
    const second = Number(match?.[2]);
    if (!match || !Number.isSafeInteger(first) || !Number.isSafeInteger(second)) {
      setError("Enter two positive safe integers as long:short, for example 3:2.");
      return;
    }
    setError("");
    if (selected) onChange({ ...selected, ratio: [first, second] });
  });
  const effectiveSwing = effective?.swing ?? swing ?? { mode: "straight" };
  const summary =
    effectiveSwing.mode === "straight"
      ? "Straight"
      : `Swing ${effectiveSwing.subdivision === "16th" ? "sixteenths" : "eighths"} ${effectiveSwing.ratio.join(":")}`;
  const preset = selected ? ratioPreset(selected.ratio) : "custom";
  const showCustomRatio = customEditing || preset === "custom";
  return (
    <div className={styles.group} role="group" aria-label="Playback">
      <SectionLabel className={styles.groupTitle} label="Playback" />
      <FormField
        label="Rhythm"
        className={styles.field}
        message={
          swing === undefined ? (
            <span aria-live="polite">
              Inherited: {summary}{" "}
              {effective?.source ? `(bar ${effective.source.measureIndex + 1})` : "(score default)"}
            </span>
          ) : undefined
        }
      >
        <ButtonGroup
          options={MODES}
          value={swing?.mode ?? "inherit"}
          onChange={(mode) => {
            setError("");
            setCustomEditing(false);
            ratio.reset();
            if (mode === "inherit") onChange(undefined);
            else if (mode === "straight") onChange({ mode: "straight" });
            else
              onChange(
                effectiveSwing.mode === "swing"
                  ? effectiveSwing
                  : { mode: "swing", subdivision: "eighth", ratio: [3, 2] },
              );
          }}
        />
      </FormField>
      {selected && (
        <>
          <div className={styles.swingFields}>
            <FormField label="Subdivision" className={styles.field}>
              <ButtonGroup
                options={SUBDIVISIONS}
                value={selected.subdivision}
                onChange={(subdivision) =>
                  onChange({ ...selected, subdivision: subdivision === "16th" ? "16th" : "eighth" })
                }
              />
            </FormField>
            <FormField
              label="Ratio"
              className={styles.field}
              action={
                <IconButton
                  size="xs"
                  variant="ghost"
                  aria-label="About swing ratios"
                  tooltip="3:2 (60%) is a Viritura preset, not an inferred source ratio. 2:1 gives triplet swing. Custom ratios use exact long:short proportions."
                >
                  <Info size={12} aria-hidden="true" />
                </IconButton>
              }
            >
              <Select
                options={RATIO_OPTIONS}
                value={showCustomRatio ? "custom" : preset}
                onValueChange={(value) => {
                  setError("");
                  ratio.reset();
                  if (value === "custom") {
                    setCustomEditing(true);
                    return;
                  }
                  setCustomEditing(false);
                  if (value === "3:2") onChange({ ...selected, ratio: [3, 2] });
                  else if (value === "2:1") onChange({ ...selected, ratio: [2, 1] });
                  else throw new Error(`Unsupported swing ratio preset: ${value}`);
                }}
              />
            </FormField>
          </div>
          {showCustomRatio && (
            <div className={styles.customRatio}>
              <FormField
                label="Custom ratio"
                className={styles.field}
                message="Long:short, using positive integers."
                error={error ? <span role="alert">{error}</span> : undefined}
              >
                <FormInput
                  value={ratio.value}
                  className={styles.input}
                  onChange={(event) => ratio.onChange(event.target.value)}
                  onBlur={ratio.onBlur}
                />
              </FormField>
            </div>
          )}
        </>
      )}
    </div>
  );
}
