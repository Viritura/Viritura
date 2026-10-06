import { useState } from "react";
import { FormField, Select } from "@viritura/ui";
import type { Score } from "@viritura/core";
import {
  staffTextToPage,
  staffTextToSystem,
  systemTextToStaff,
  TextAttachmentError,
} from "../../score/textFrameAttachment";
import type { NotationSelectionTarget } from "../../commands/notationInspectorCommands";
import { useViewStateStore } from "../../store/viewStateStore";
import { useSelectionActions } from "../../store/selectionStore";
import { textFrameElementId } from "./textFrameContext";
import { useTextFrameSelectionStore } from "./textFrameSelection";

interface TextPositioningFieldProps {
  value: "staff" | "page";
  onChange: (value: "staff" | "page") => void;
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
            if (next !== "page" && next !== "staff") return;
            if (next === value) return;
            try {
              onChange(next);
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

function TextScopeField({
  value,
  onChange,
}: {
  value: "staff" | "system";
  onChange: (scope: "staff" | "system") => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <FormField label="Text scope">
        <Select
          aria-label="Text scope"
          value={value}
          options={[
            { value: "staff", label: "Staff" },
            { value: "system", label: "System" },
          ]}
          onValueChange={(next) => {
            if (next !== "staff" && next !== "system") return;
            if (next === value) return;
            try {
              onChange(next);
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
  const systemTextSelected = target.elementType === "system-text" && target.systemTextId !== undefined;
  if (systemTextSelected) {
    return (
      <TextScopeField
        value="system"
        onChange={(scope) => {
          if (scope !== "staff") return;
          const result = systemTextToStaff(score, target.partIndex, target.measureIndex, target.systemTextId!);
          updateScore(result.score);
          selectElement(result.elementId);
        }}
      />
    );
  }
  const expressionMatch = target.elementType.match(/^expr(\d+)$/);
  if (!expressionMatch) return null;
  const expressionIndex = Number.parseInt(expressionMatch[1]!, 10);
  return (
    <>
      <TextPositioningField
        value="staff"
        onChange={(next) => {
          if (next !== "page") return;
          const result = staffTextToPage(score, scoreIndex, target.partIndex, target.measureIndex, expressionIndex);
          updateScore(result.score);
          selectElement(textFrameElementId(result.frameId));
          selectFrame(result.frameId);
        }}
      />
      <TextScopeField
        value="staff"
        onChange={(scope) => {
          if (scope !== "system") return;
          const result = staffTextToSystem(score, target.partIndex, target.measureIndex, expressionIndex);
          updateScore(result.score);
          selectElement(result.elementId);
        }}
      />
    </>
  );
}
