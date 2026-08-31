import { X } from "lucide-react";
import { Button, Dialog, DialogHeader, ListRow, Text } from "@viritura/ui";
import type { DiscoveredEntry } from "./profileHostBridge";
import styles from "./instrumentProfiles.module.css";

interface SourcePickerDialogProps {
  open: boolean;
  title: string;
  entries: readonly DiscoveredEntry[];
  loading: boolean;
  /** Currently-bound path, highlighted in the list if present. */
  currentPath?: string;
  emptyHint: string;
  /** A discovered entry was chosen; receives its absolute path. */
  onPick: (path: string) => void;
  /** The "Browse for file…" fallback was chosen (native/prompt file picker). */
  onBrowse: () => void;
  /** Open the search-folder configuration. */
  onConfigureFolders: () => void;
  onClose: () => void;
}

/**
 * A dedicated picker window listing the plugins or scripts discovered in the
 * configured search folders — the DAW-style plugin browser. "Browse for file…"
 * escapes to a native file picker for anything outside those folders, and
 * "Configure folders…" opens the folder settings so the list can be expanded.
 */
export function SourcePickerDialog({
  open,
  title,
  entries,
  loading,
  currentPath,
  emptyHint,
  onPick,
  onBrowse,
  onConfigureFolders,
  onClose,
}: SourcePickerDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} size="default">
      <DialogHeader title={title} onClose={onClose} closeIcon={<X size={14} />} />
      <div className={styles.pickerBody}>
        {loading ? (
          <Text variant="eyebrow" tone="muted">
            Scanning…
          </Text>
        ) : entries.length === 0 ? (
          <Text variant="eyebrow" tone="muted">
            {emptyHint}
          </Text>
        ) : (
          <div className={styles.pickerList}>
            {entries.map((entry) => (
              <ListRow
                key={entry.path}
                density="compact"
                selected={entry.path === currentPath}
                trailing={entry.path === currentPath ? "in use" : undefined}
                tooltip={entry.path}
                onClick={() => onPick(entry.path)}
              >
                {entry.name}
              </ListRow>
            ))}
          </div>
        )}
        <div className={styles.pickerActions}>
          <Button label="Configure folders…" onClick={onConfigureFolders} />
          <Button label="Browse for file…" onClick={onBrowse} />
        </div>
      </div>
    </Dialog>
  );
}
