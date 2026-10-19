import { CondensingPopover, type CondensingMode } from "../components/CondensingPopover";
import { applyCondensingOverride } from "./popoverHandlers";
import { closeDialog } from "../store/dialogStore";
import type { DocumentStore } from "../store/documentStore";
import type { SelectionState } from "../store/selectionStore";
import type { NoteInputState } from "../store/noteInputStore";
import type { Score } from "@viritura/core";

interface CondensingPopoverOverlayProps {
  open: boolean;
  position: { x: number; y: number };
  store: DocumentStore;
  selection: SelectionState;
  noteInputState: NoteInputState;
  selectedScoreIndex: number;
  selectedMeasureIndex: () => number | null;
  setCondensingRouting: (mode: CondensingMode) => void;
  updateScore: (score: Score) => void;
}

export function CondensingPopoverOverlay({
  open,
  position,
  store,
  selection,
  noteInputState,
  selectedScoreIndex,
  selectedMeasureIndex,
  setCondensingRouting,
  updateScore,
}: CondensingPopoverOverlayProps) {
  return (
    <CondensingPopover
      open={open}
      position={position}
      sourceCount={2}
      currentMode={noteInputState.condensingRouting ?? undefined}
      onSelectMode={(mode) => {
        setCondensingRouting(mode);
        closeDialog("condensingPopover");
        const { score } = store.getState();
        if (!score) return;
        const newScore = applyCondensingOverride({
          score,
          selection,
          noteInputState,
          selectedScoreIndex,
          measureIndex: selectedMeasureIndex() ?? 0,
          mode,
        });
        if (newScore !== score) updateScore(newScore);
      }}
      onClose={() => closeDialog("condensingPopover")}
    />
  );
}
