import type { SystemText } from "@viritura/core";
import { TextPopover } from "@viritura/ui";
import { applyInlineInstruction, inlineInstructionValue, parseInlineInstruction } from "./inlineEntry";

export function SystemInstructionPopover({
  instruction,
  position,
  onSubmit,
  onClose,
}: {
  instruction: SystemText;
  position: { x: number; y: number };
  onSubmit: (instruction: SystemText) => void;
  onClose: () => void;
}) {
  return (
    <TextPopover
      open
      position={position}
      title="System text / tempo"
      placeholder="Freely, Allegro q=180, or q=180"
      initialValue={inlineInstructionValue(instruction)}
      validate={(value) => {
        const result = parseInlineInstruction(value);
        return result.ok ? null : result.error;
      }}
      renderPreview={(value) => {
        const result = parseInlineInstruction(value);
        return result.ok ? null : <span role="alert">{result.error}</span>;
      }}
      onSubmit={(value) => onSubmit(applyInlineInstruction(instruction, value))}
      onClose={onClose}
    />
  );
}
