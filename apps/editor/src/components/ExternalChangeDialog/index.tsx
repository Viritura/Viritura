import { RefreshCw, Save } from "lucide-react";
import { ActionTile, Dialog, DialogActions, DialogBody, DialogCancelButton, DialogTitle } from "@viritura/ui";
import type { ExternalChangeChoice } from "../../store/modalFlowStore";
import styles from "./styles.module.css";

export interface ExternalChangeDialogProps {
  open: boolean;
  fileName: string;
  onChoose: (choice: ExternalChangeChoice) => void;
  onCancel: () => void;
}

export function ExternalChangeDialog({ open, fileName, onChoose, onCancel }: ExternalChangeDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>External changes detected</DialogTitle>
      <DialogBody className={styles.body}>
        <p className={styles.intro}>
          &quot;{fileName}&quot; changed outside Viritura after it was opened. Choose which version to keep.
        </p>
        <div className={styles.optionList}>
          <ActionTile
            variant="recommended"
            icon={<RefreshCw size={18} />}
            title="Discard my changes"
            hint="Reload the external file and discard unsaved changes made in Viritura."
            onClick={() => onChoose("reload")}
            autoFocus
          />
          <ActionTile
            icon={<Save size={18} />}
            title="Keep my changes"
            hint="Overwrite the external file with the version currently open in Viritura."
            onClick={() => onChoose("overwrite")}
          />
        </div>
      </DialogBody>
      <DialogActions>
        <DialogCancelButton>Cancel</DialogCancelButton>
      </DialogActions>
    </Dialog>
  );
}
