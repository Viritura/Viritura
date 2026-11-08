import { useState } from "react";
import type { ResolvedTempoSwing, Swing } from "@viritura/core";
import { Button, ButtonGroup, FormInput } from "@viritura/ui";
import { useDebouncedInput } from "../../hooks/useDebouncedInput";
import { labelStyle } from "./types";

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

export function SwingControls({ swing, effective, onChange }: SwingControlsProps) {
  const [error, setError] = useState("");
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
  return (
    <div>
      <div style={labelStyle}>
        <span>Rhythm instruction</span>
        <ButtonGroup
          ariaLabel="Rhythm instruction"
          options={MODES}
          value={swing?.mode ?? "inherit"}
          onChange={(mode) => {
            setError("");
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
      </div>
      <p aria-live="polite">
        Effective: {summary} —{" "}
        {effective?.source
          ? `measure ${effective.source.measureIndex + 1}, tempo ${effective.source.tempoIndex + 1}`
          : "score default"}
      </p>
      {selected && (
        <>
          <div style={labelStyle}>
            <span>Swing subdivision</span>
            <ButtonGroup
              ariaLabel="Swing subdivision"
              options={SUBDIVISIONS}
              value={selected.subdivision}
              onChange={(subdivision) =>
                onChange({ ...selected, subdivision: subdivision === "16th" ? "16th" : "eighth" })
              }
            />
          </div>
          <div>
            <Button
              onClick={() => {
                setError("");
                ratio.reset();
                onChange({ ...selected, ratio: [3, 2] });
              }}
            >
              60% (3:2)
            </Button>
            <Button
              onClick={() => {
                setError("");
                ratio.reset();
                onChange({ ...selected, ratio: [2, 1] });
              }}
            >
              Triplet (2:1)
            </Button>
          </div>
          <p>3:2 is an application preset, not an inferred source ratio.</p>
          <label style={labelStyle}>
            Custom long:short ratio
            <FormInput
              value={ratio.value}
              onChange={(event) => ratio.onChange(event.target.value)}
              onBlur={ratio.onBlur}
              aria-invalid={!!error}
            />
          </label>
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </div>
  );
}
