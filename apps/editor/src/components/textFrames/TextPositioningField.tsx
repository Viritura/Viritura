import { useState } from "react";
import { FormField, Select } from "@viritura/ui";
import type { Score } from "@viritura/core";
import { staffTextToPage, TextAttachmentError } from "../../score/textFrameAttachment";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { useViewStateStore } from "../../store/viewStateStore";
import { useSelectionActions } from "../../store/selectionStore";
import { textFrameElementId } from "./textFrameContext";
import { useTextFrameSelectionStore } from "./textFrameSelection";

interface TextPositioningFieldProps {
  value: "staff" | "page";
  onChange: () => void;
}

export function TextPositioningField({ value, onChange }: TextPositioningFieldProps) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <FormField label="Position relative to">
        <Select
          aria-label="Position relative to"
          value={value}
          options={[
            { value: "staff", label: "Staff" },
            { value: "page", label: "Page" },
          ]}
          onValueChange={(next) => {
            if (next === value) return;
            try {
              onChange();
              setError(null);
            } catch (cause) {
              if (!(cause instanceof TextAttachmentError)) throw cause;
              setError(cause.message);
            }
          }}
        />
      </FormField>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export function StaffTextPositioningField({
  score,
  target,
  updateScore,
}: {
  score: Score | null;
  target: NotationSelectionTarget | null;
  updateScore: (score: Score) => void;
}) {
  const scoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const { selectElement } = useSelectionActions();
  const selectFrame = useTextFrameSelectionStore((state) => state.setSelectedFrameId);
  if (!score || !target) return null;
  return (
    <TextPositioningField
      value="staff"
      onChange={() => {
        const expressionIndex = Number(target.elementType.slice("expr".length));
        const result = staffTextToPage(score, scoreIndex, target.partIndex, target.measureIndex, expressionIndex);
        updateScore(result.score);
        selectElement(textFrameElementId(result.frameId));
        selectFrame(result.frameId);
      }}
    />
  );
}
