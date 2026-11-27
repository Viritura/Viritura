import { useState } from "react";
import { resolveClickGrouping, type Tempo, type TimeSignature } from "@viritura/core";
import { Button, FormField, FormInput, Select } from "@viritura/ui";
import { parseClickGroupingInput } from "./clickGroupingInput";

interface ClickSettingsFieldsProps {
  tempo: Tempo;
  timeSignature: TimeSignature;
  canFollow: boolean;
  onSubdivisionChange: (subdivision: Tempo["clickSubdivision"]) => void;
  onGroupingChange?: (settings: Pick<Tempo, "clickSubdivision" | "clickGrouping">) => void;
}

const FOLLOW = "follow";

export function ClickSettingsFields({
  tempo,
  timeSignature,
  canFollow,
  onSubdivisionChange,
  onGroupingChange,
}: ClickSettingsFieldsProps) {
  const [selection, setSelection] = useState(String(tempo.clickSubdivision ?? (canFollow ? FOLLOW : 1)));
  const [groupingText, setGroupingText] = useState(tempo.clickGrouping?.join("+") ?? "");
  const [error, setError] = useState<string>();
  const grouped = groupingText.trim().length > 0;
  const applyGrouping = () => {
    if (!onGroupingChange) return;
    const subdivision = Number(selection);
    if (
      subdivision !== 0 &&
      subdivision !== 1 &&
      subdivision !== 2 &&
      subdivision !== 3 &&
      subdivision !== 4 &&
      subdivision !== 5
    ) {
      setError("Choose a click division before applying a grouping.");
      return;
    }
    const text = groupingText.trim();
    if (!text) {
      onGroupingChange({ clickSubdivision: subdivision, clickGrouping: undefined });
      setError(undefined);
      return;
    }
    const clickGrouping = parseClickGroupingInput(text);
    if (!clickGrouping) {
      setError("Enter positive group lengths separated by +, commas, or spaces.");
      return;
    }
    try {
      resolveClickGrouping(timeSignature, subdivision, clickGrouping);
    } catch (cause) {
      if (!(cause instanceof RangeError)) throw cause;
      setError(cause.message);
      return;
    }
    setError(undefined);
    onGroupingChange({ clickSubdivision: subdivision, clickGrouping });
  };
  return (
    <>
      <FormField label={grouped ? "Click grid division" : "Clicks per beat"}>
        <Select
          value={selection}
          options={[
            ...(canFollow ? [{ value: FOLLOW, label: "Follow tempo" }] : []),
            { value: "0", label: "No clicks (free time)" },
            ...[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) })),
          ]}
          onValueChange={(value) => {
            setSelection(value);
            setError(undefined);
            if (value === FOLLOW) {
              setGroupingText("");
              onSubdivisionChange(undefined);
              return;
            }
            const subdivision = Number(value);
            if (
              subdivision !== 0 &&
              subdivision !== 1 &&
              subdivision !== 2 &&
              subdivision !== 3 &&
              subdivision !== 4 &&
              subdivision !== 5
            ) {
              throw new RangeError("Click subdivision must be an integer from 0 to 5.");
            }
            if (subdivision === 0) setGroupingText("");
            if (!grouped || subdivision === 0) onSubdivisionChange(subdivision);
          }}
        />
      </FormField>
      {onGroupingChange && (
        <>
          <FormField label="Click grouping">
            <FormInput
              value={groupingText}
              placeholder="e.g. 3+3+2+2+2"
              aria-invalid={error !== undefined}
              onChange={(event) => {
                setGroupingText(event.target.value);
                setError(undefined);
                if (selection === FOLLOW || selection === "0") setSelection("1");
              }}
            />
          </FormField>
          <p>
            In {timeSignature.count}/{timeSignature.unit}, the grid division splits each denominator note. Group lengths
            must total {timeSignature.count} × the division. Leave empty for regular meter clicks.
          </p>
          <Button onClick={applyGrouping}>Apply click grouping</Button>
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </>
  );
}
