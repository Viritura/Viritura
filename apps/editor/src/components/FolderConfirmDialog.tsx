/**
 * FolderConfirmDialog — shown when the user opens a folder that doesn't
 * contain a `.git` directory. Replaces the prior silent `git init` so the
 * user is in control of when a Git repo is created.
 *
 * Modes:
 *  • `init` — initialise a new Git repo here (recommended).
 *  • `plain` — open as a plain workspace folder (no version history).
 *  • `cancel` — abort, e.g. user picked the wrong folder.
 */
import { GitBranchPlus, FolderOpen } from "lucide-react";
import { ActionTile, Dialog, DialogTitle, DialogBody, DialogActions, DialogCancelButton } from "@viritura/ui";
import styles from "./FolderConfirmDialog.module.css";

export type FolderConfirmChoice = "init" | "plain";

export interface FolderConfirmDialogProps {
  open: boolean;
  /** Display name of the picked folder. */
  folderName: string;
  /** Optional: how many `.mnx` files were detected (for messaging). */
  scoreCount: number;
  onChoose: (choice: FolderConfirmChoice) => void;
  onCancel: () => void;
}

export function FolderConfirmDialog({ open, folderName, scoreCount, onChoose, onCancel }: FolderConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>Open “{folderName}”</DialogTitle>
      <DialogBody className={styles.body}>
        <div className={styles.intro}>
          This folder isn&rsquo;t tracked by Git yet.
          {scoreCount === 0
            ? " It also doesn't contain any `.mnx` scores — initializing creates an empty project you can add scores to."
            : ""}
        </div>
        <div className={styles.optionList}>
          <ActionTile
            variant="recommended"
            icon={<GitBranchPlus size={18} />}
            title="Initialize Git project"
            hint="Creates a `.git` directory here. Your changes will be tracked with full history and branching."
            onClick={() => onChoose("init")}
            autoFocus
          />
          <ActionTile
            icon={<FolderOpen size={18} />}
            title="Open without Git"
            hint="Edit files in place. No version history. You can initialize Git later from the File menu."
            onClick={() => onChoose("plain")}
          />
        </div>
      </DialogBody>
      <DialogActions>
        <DialogCancelButton>Cancel</DialogCancelButton>
      </DialogActions>
    </Dialog>
  );
}
