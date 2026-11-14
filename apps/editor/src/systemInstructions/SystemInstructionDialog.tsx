import { useState } from "react";
import type { ResolvedTempoSwing, SystemText } from "@viritura/core";
import { Button, Dialog, DialogActions, DialogBody, DialogHeader } from "@viritura/ui";
import { SystemInstructionFields } from "./SystemInstructionFields";

export function SystemInstructionDialog({
  initialInstruction,
  onSubmit,
  onClose,
  resolveSwing,
}: {
  initialInstruction: SystemText;
  onSubmit: (instruction: SystemText) => void;
  onClose: () => void;
  resolveSwing?: (instruction: SystemText) => ResolvedTempoSwing | undefined;
}) {
  const [instruction, setInstruction] = useState(initialInstruction);
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader title="System instruction" onClose={onClose} />
      <DialogBody>
        <SystemInstructionFields
          instruction={instruction}
          onChange={setInstruction}
          effectiveSwing={resolveSwing?.(instruction)}
        />
      </DialogBody>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={
            !instruction.tempo &&
            !instruction.text.some((chunk) =>
              "text" in chunk ? chunk.text.trim().length > 0 : chunk.glyphs.length > 0,
            )
          }
          onClick={() => {
            onSubmit(instruction);
            onClose();
          }}
        >
          OK
        </Button>
      </DialogActions>
    </Dialog>
  );
}
