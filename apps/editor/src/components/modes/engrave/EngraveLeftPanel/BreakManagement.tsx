import { useState } from "react";
import { PanelActionButton, PanelHeader } from "@viritura/ui";
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
    <section className={styles.breakManagement} aria-label="Forced breaks">
      <PanelHeader
        title="Forced breaks"
        subtitle={selectionDescription}
        actions={
          <>
            <PanelActionButton
              disabled={selectedBreakKind === null}
              onClick={onRemoveSelectedBreak}
              tooltip="Remove selected break"
            >
              Remove
            </PanelActionButton>
            <PanelActionButton
              disabled={!hasLayoutOverrides}
              onClick={() => setConfirmReset(true)}
              tooltip="Reset all layout overrides"
            >
              Reset all
            </PanelActionButton>
          </>
        }
      />
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
