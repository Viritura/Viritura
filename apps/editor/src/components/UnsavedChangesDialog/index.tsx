import { Save, Trash2 } from "lucide-react";
import { ActionTile, Dialog, DialogActions, DialogBody, DialogCancelButton, DialogTitle } from "@viritura/ui";
import type { UnsavedChangesChoice } from "../../store/modalFlowStore";
import styles from "./styles.module.css";

export interface UnsavedChangesDialogProps {
  open: boolean;
  fileName: string;
  onChoose: (choice: UnsavedChangesChoice) => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({ open, fileName, onChoose, onCancel }: UnsavedChangesDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>Unsaved changes</DialogTitle>
      <DialogBody className={styles.body}>
        <p className={styles.intro}>&quot;{fileName}&quot; has changes that are not saved yet.</p>
        <div className={styles.optionList}>
          <ActionTile
            variant="recommended"
            icon={<Save size={18} />}
            title="Save and switch"
            hint="Save this score, then open the other file."
            onClick={() => onChoose("save")}
            autoFocus
          />
          <ActionTile
            icon={<Trash2 size={18} />}
            title="Discard changes"
            hint="Open the other file without saving this score."
            onClick={() => onChoose("discard")}
          />
        </div>
      </DialogBody>
      <DialogActions>
        <DialogCancelButton>Cancel</DialogCancelButton>
      </DialogActions>
    </Dialog>
  );
}
