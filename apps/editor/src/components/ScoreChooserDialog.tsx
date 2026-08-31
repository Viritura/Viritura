/**
 * ScoreChooserDialog — shown when an opened folder contains more than one
 * `.mnx` file. The user picks which score to load as the active document.
 *
 * Used by the "Open Folder" flow when the picked folder is e.g. a portfolio
 * monorepo holding multiple works, or a project where the score lives in a
 * subfolder.
 */
import { useState } from "react";
import { Music } from "lucide-react";
import {
  Dialog,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogCancelButton,
  DialogPrimaryButton,
  ListRow,
} from "@viritura/ui";
import styles from "./ScoreChooserDialog.module.css";
import type { DiscoveredScore } from "../store/folderScan";

export interface ScoreChooserDialogProps {
  open: boolean;
  /** Display name of the picked folder (for context). */
  folderName: string;
  /** All `.mnx` files discovered inside the folder. */
  scores: DiscoveredScore[];
  onChoose: (score: DiscoveredScore) => void;
  onCancel: () => void;
}

export function ScoreChooserDialog({ open, folderName, scores, onChoose, onCancel }: ScoreChooserDialogProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(scores[0]?.relativePath ?? null);

  const selected = scores.find((s) => s.relativePath === selectedPath) ?? null;

  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>Choose a score</DialogTitle>
      <DialogBody className={styles.body}>
        <div className={styles.intro}>
          <strong>{folderName}</strong> contains {scores.length} scores. Pick one to open. The folder remains the
          project root.
        </div>
        <div className={styles.list} role="listbox" aria-label="Scores">
          {scores.map((score) => {
            const isSelected = score.relativePath === selectedPath;
            return (
              <ListRow
                key={score.relativePath}
                role="option"
                aria-selected={isSelected}
                selected={isSelected}
                leading={<Music className={styles.itemIcon} aria-hidden="true" />}
                onClick={() => setSelectedPath(score.relativePath)}
                onDoubleClick={() => onChoose(score)}
              >
                <div className={styles.itemBody}>
                  <div className={styles.itemName}>{score.name}</div>
                  <div className={styles.itemPath}>{score.relativePath}</div>
                </div>
              </ListRow>
            );
          })}
        </div>
      </DialogBody>
      <DialogActions>
        <DialogCancelButton>Cancel</DialogCancelButton>
        <DialogPrimaryButton
          disabled={!selected}
          onClick={() => {
            if (selected) onChoose(selected);
          }}
        >
          Open
        </DialogPrimaryButton>
      </DialogActions>
    </Dialog>
  );
}
