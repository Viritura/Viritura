import { useCallback, useId, useMemo, useState } from "react";
import {
  ButtonGroup,
  Dialog,
  DialogActions,
  DialogBody,
  DialogCancelButton,
  DialogPrimaryButton,
  DialogTitle,
  FormField,
  Section,
  Select,
} from "@viritura/ui";
import type { TransposeDirection, TransposeMode, TransposeParams } from "../../commands/transposeCommands";
import type { TransposeSelectionInfo } from "./transposeSelection";
import { buildTransposeIntervalOptions } from "./transposeOptions";
import styles from "./TransposeDialog.module.css";

interface TransposeDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onApply: (params: TransposeParams) => void;
  readonly selection: TransposeSelectionInfo;
}

const DIRECTION_OPTIONS = [
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
] satisfies { value: TransposeDirection; label: string }[];

const MODE_OPTIONS = [
  { value: "chromatic", label: "Chromatic" },
  { value: "diatonic", label: "Diatonic" },
] satisfies { value: TransposeMode; label: string }[];

export function TransposeDialog({ open, onClose, onApply, selection }: TransposeDialogProps) {
  const directionLabelId = useId();
  const methodLabelId = useId();
  const [direction, setDirection] = useState<TransposeDirection>("up");
  const [mode, setMode] = useState<TransposeMode>("chromatic");
  const [interval, setInterval] = useState("Minor 2nd");

  const intervalOptions = useMemo(() => buildTransposeIntervalOptions(mode, direction), [mode, direction]);

  const handleModeChange = useCallback((nextMode: TransposeMode) => {
    setMode(nextMode);
    setInterval(nextMode === "chromatic" ? "Minor 2nd" : "2nd");
  }, []);

  const handleApply = useCallback(() => {
    onApply({ direction, mode, interval });
    onClose();
  }, [direction, mode, interval, onApply, onClose]);

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>Transpose Selection</DialogTitle>
      <DialogBody>
        <div className={styles.scope} aria-label="Transpose scope">
          <span className={styles.scopeLabel}>Selection</span>
          <strong>{selection.description}</strong>
          <span className={styles.scopeHint}>Rests, rhythm, and key signatures are unchanged.</span>
        </div>

        <Section title="Transpose by" variant="inset" className={styles.controls}>
          <div className={styles.field}>
            <span id={directionLabelId} className={styles.fieldLabel}>
              Direction
            </span>
            <ButtonGroup
              options={DIRECTION_OPTIONS}
              value={direction}
              onChange={setDirection}
              ariaLabelledBy={directionLabelId}
            />
          </div>

          <div className={styles.field}>
            <span id={methodLabelId} className={styles.fieldLabel}>
              Method
            </span>
            <ButtonGroup
              options={MODE_OPTIONS}
              value={mode}
              onChange={handleModeChange}
              ariaLabelledBy={methodLabelId}
            />
          </div>

          <p className={styles.methodHint}>
            {mode === "chromatic"
              ? "Move by an exact number of semitones."
              : "Move by staff steps in the active key signature."}
          </p>

          <FormField label="Interval" className={styles.lastField}>
            <Select value={interval} onValueChange={setInterval} options={intervalOptions} />
          </FormField>
        </Section>
      </DialogBody>

      <DialogActions>
        <DialogCancelButton />
        <DialogPrimaryButton onClick={handleApply} disabled={selection.noteCount === 0}>
          Transpose Selection
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}
