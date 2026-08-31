import { X } from "lucide-react";
import { Dialog, DialogHeader } from "@viritura/ui";
import { ScanFoldersSettings } from "./ScanFoldersSettings";
import styles from "./instrumentProfiles.module.css";

/**
 * The search-folder configuration as its own window, opened from a source picker
 * ("Configure folders…"). Adding a folder here immediately widens what the
 * picker discovers, since the pickers rescan whenever the folder lists change.
 */
export function FolderConfigDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} size="wide">
      <DialogHeader title="Search Folders" onClose={onClose} closeIcon={<X size={14} />} />
      <div className={styles.editorBody}>
        <ScanFoldersSettings />
      </div>
    </Dialog>
  );
}
