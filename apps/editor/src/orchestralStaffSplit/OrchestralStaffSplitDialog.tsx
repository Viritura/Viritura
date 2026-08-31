import { useMemo, useState } from "react";
import { Split } from "lucide-react";
import { toast } from "sonner";
import type { Score } from "@viritura/core";
import { Dialog, DialogActions, DialogBody, DialogCancelButton, DialogPrimaryButton, DialogTitle } from "@viritura/ui";
import { analyzeOrchestralPartSplit } from "./analysis";
import { splitOrchestralParts } from "./transform";
import styles from "./OrchestralStaffSplitDialog.module.css";

interface OrchestralStaffSplitDialogProps {
  readonly open: boolean;
  readonly score: Score | null;
  readonly onClose: () => void;
  readonly onUpdateScore: (score: Score) => void;
}

export function OrchestralStaffSplitDialog({ open, score, onClose, onUpdateScore }: OrchestralStaffSplitDialogProps) {
  const analysis = useMemo(() => analyzeOrchestralPartSplit(score), [score]);
  const [applyFailure, setApplyFailure] = useState<{ readonly score: Score; readonly message: string } | null>(null);

  const handleClose = () => {
    setApplyFailure(null);
    onClose();
  };

  const handleApply = () => {
    if (!score || analysis.error) return;
    try {
      onUpdateScore(splitOrchestralParts(score));
      toast.success("Split combined orchestral parts and created Condensed Score");
      handleClose();
    } catch (error) {
      setApplyFailure({ score, message: error instanceof Error ? error.message : String(error) });
    }
  };

  const error = (applyFailure?.score === score ? applyFailure.message : null) ?? analysis.error;

  return (
    <Dialog open={open} onClose={handleClose} size="compact">
      <DialogTitle className={styles.title}>
        <Split size={18} aria-hidden="true" />
        Split Combined Orchestral Parts
      </DialogTitle>
      <DialogBody className={styles.body}>
        <div className={styles.partList} aria-label="Detected orchestral parts">
          {analysis.parts.map((part) => (
            <div className={styles.partRow} key={part.id}>
              <span className={styles.partIdentity}>
                <strong>{part.name}</strong>
                <span>{part.id}</span>
              </span>
              <span className={styles.staffCount}>
                <span aria-hidden="true">→</span>
                <strong>{part.resultingParts.map((resultPart) => resultPart.name).join(", ")}</strong>
              </span>
            </div>
          ))}
        </div>

        <p className={styles.routingSummary}>
          Player labels route single lines; dyads split high/low; independent voices split by order; unlabelled singles
          go to the first player.
        </p>
        <p className={styles.routingSummary}>
          The full score will use separate player Parts, and a separate Condensed Score will be created.
        </p>
        <p className={styles.labelCount}>
          {analysis.recognizedRoutingLabelCount === 1
            ? "1 routing label recognized"
            : `${String(analysis.recognizedRoutingLabelCount)} routing labels recognized`}
        </p>

        {error && (
          <div className={styles.error} role="alert">
            <strong>Cannot split these parts.</strong>
            <span>{error}</span>
          </div>
        )}
      </DialogBody>
      <DialogActions>
        <DialogCancelButton />
        <DialogPrimaryButton onClick={handleApply} disabled={Boolean(error)} testId="orchestral-staff-split-apply">
          Split Parts
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}
