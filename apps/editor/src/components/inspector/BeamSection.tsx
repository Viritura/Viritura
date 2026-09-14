import type { CSSProperties } from "react";
import { Button, Select } from "@viritura/ui";
import type { BeamInspectorState, BeamletChoice } from "./useBeamInspector";
import { labelStyle, legendStyle, sectionStyle } from "./types";

const ACTION_ROW_STYLE: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "0.5rem" };
const STATUS_STYLE: CSSProperties = { color: "var(--text-muted)", fontSize: "var(--type-eyebrow-size)" };

interface BeamSectionProps {
  state: BeamInspectorState;
}

function beamletLabel(state: BeamInspectorState["beamletState"]): string {
  if (state === null) return "Unavailable";
  if (state === "right") return "Forward";
  if (state === "left") return "Backward";
  if (state === "auto") return "Automatic";
  return "Full beam";
}

export function BeamSection({ state }: BeamSectionProps) {
  if (!state.isAvailable) return null;
  const levelOptions = Array.from({ length: state.maxLevel }, (_, index) => {
    const level = index + 1;
    return {
      value: String(level),
      label:
        level === 1 ? "Primary (1)" : level === 2 ? "Secondary (2)" : level === 3 ? "Tertiary (3)" : `Level ${level}`,
    };
  });
  const beamletActions: Array<{ choice: BeamletChoice; label: string; disabled: boolean }> = [
    { choice: "full", label: "Full beam", disabled: !state.canSetFull },
    { choice: "automatic", label: "Automatic", disabled: !state.canSetAutomatic },
    { choice: "forward", label: "Forward", disabled: !state.canSetForward },
    { choice: "backward", label: "Backward", disabled: !state.canSetBackward },
  ];

  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Beam</legend>
      <label style={labelStyle}>
        Beam level
        <Select
          value={String(state.level)}
          options={levelOptions}
          onValueChange={(value) => state.setLevel(Number(value))}
          aria-label="Beam level"
          data-testid="notation-beam-level"
        />
      </label>
      <div style={ACTION_ROW_STYLE}>
        <Button size="sm" label="Join selected notes" onClick={state.join} disabled={!state.canJoin} />
        <Button size="sm" label="Break after selection" onClick={state.breakAfter} disabled={!state.canBreak} />
      </div>
      {state.level >= 2 && state.selectedEventCount === 1 && (
        <>
          <span style={STATUS_STYLE}>Current: {beamletLabel(state.beamletState)}</span>
          <div style={ACTION_ROW_STYLE} aria-label="Beamlet direction">
            {beamletActions.map((action) => (
              <Button
                key={action.choice}
                size="sm"
                label={action.label}
                onClick={() => state.setBeamlet(action.choice)}
                disabled={action.disabled}
              />
            ))}
          </div>
        </>
      )}
    </fieldset>
  );
}
