import { useState } from "react";
import { Button } from "@viritura/ui";
import { ConfirmationDialog } from "../../../ConfirmationDialog";
import styles from "./EngraveLeftPanel.module.css";

interface BreakManagementProps {
  selectedBreakKind: "system" | "page" | null;
  selectedAfterMeasureNumber?: number;
  hasLayoutOverrides: boolean;
  onRemoveSelectedBreak: () => void;
  onResetAll: () => void;
}

export function BreakManagement({
  selectedBreakKind,
  selectedAfterMeasureNumber,
  hasLayoutOverrides,
  onRemoveSelectedBreak,
  onResetAll,
}: BreakManagementProps) {
  const [confirmReset, setConfirmReset] = useState(false);
  const selectionDescription =
    selectedAfterMeasureNumber === undefined
      ? "Select a barline or break marker to manage a forced break."
      : selectedBreakKind
        ? `${selectedBreakKind === "page" ? "Page" : "System"} break after measure ${selectedAfterMeasureNumber}.`
        : `No forced break after measure ${selectedAfterMeasureNumber}.`;

  return (
    <section className={styles.breakManagement} aria-labelledby="forced-breaks-heading">
      <div>
        <h3 id="forced-breaks-heading" className={styles.sectionTitle}>
          Forced breaks
        </h3>
        <p className={styles.sectionDescription}>{selectionDescription}</p>
      </div>
      <div className={styles.breakActions}>
        <Button variant="danger" size="sm" disabled={selectedBreakKind === null} onClick={onRemoveSelectedBreak}>
          Remove selected break
        </Button>
        <Button variant="ghost" size="sm" disabled={!hasLayoutOverrides} onClick={() => setConfirmReset(true)}>
          Reset all layout overrides
        </Button>
      </div>
      <ConfirmationDialog
        open={confirmReset}
        title="Reset all layout overrides?"
        message="This removes every forced system and page break and clears system-specific layout overrides for this score."
        confirmLabel="Reset all"
        onConfirm={() => {
          setConfirmReset(false);
          onResetAll();
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </section>
  );
}
