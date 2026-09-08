import type { CSSProperties } from "react";
import type { Score, SequenceContent } from "@viritura/core";
import { Button, ButtonGroup, FormInput } from "@viritura/ui";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { useRestPositionHandlers } from "./useNotationInspectorActions";
import { labelStyle, legendStyle, sectionStyle } from "./types";

const MODE_OPTIONS: { value: "auto" | "explicit"; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "explicit", label: "Explicit" },
];

const actionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-2)",
};

interface RestPositionSectionProps {
  score: Score | null;
  target: NotationSelectionTarget | null;
  event: SequenceContent | null;
  updateScore: (score: Score) => void;
}

export function RestPositionSection({ score, target, event, updateScore }: RestPositionSectionProps) {
  const { setRestPositionMode, setRestPosition, moveRest, resetRestPosition } = useRestPositionHandlers({
    score,
    target,
    updateScore,
  });
  if (event?.type !== "event" || !event.rest) return null;
  const staffPosition = event.rest.staffPosition;
  const explicit = staffPosition !== undefined;
  return (
    <fieldset style={sectionStyle}>
      <legend style={legendStyle}>Rest position</legend>
      <ButtonGroup
        options={MODE_OPTIONS}
        value={explicit ? "explicit" : "auto"}
        onChange={setRestPositionMode}
        ariaLabel="Rest position mode"
      />
      {explicit && (
        <>
          <label style={labelStyle}>
            Staff position
            <FormInput
              aria-label="Staff position"
              type="number"
              step="1"
              value={String(staffPosition)}
              onChange={(input) => setRestPosition(Number.parseInt(input.target.value, 10))}
            />
          </label>
          <div style={actionsStyle}>
            <Button size="sm" onClick={() => moveRest(1)} label="Move up" />
            <Button size="sm" onClick={() => moveRest(-1)} label="Move down" />
            <Button size="sm" variant="link" onClick={resetRestPosition} label="Reset" />
          </div>
        </>
      )}
    </fieldset>
  );
}
