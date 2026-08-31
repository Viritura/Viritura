import { useMemo, useCallback } from "react";
import { useDocumentStore, useDocumentActions } from "../../store/DocumentContext";
import { useSelection } from "../../store/selectionStore";
import { usePlaybackActions } from "@viritura/playback";
import { extractPartIndex } from "../../score/ElementPath";
import { isPercussionPart } from "../../score/kitInput";
import { useDrumKitTargetStore, advanceDrumKitReview, clearDrumKitTarget } from "../../store/drumKitTargetStore";
import { findPercussionPartIndex, resolveDrumKitTarget, applyDrumKitEdits } from "../../commands/drumKitCommands";
import { DrumKitDialog, type KitComponentEdit } from "./index";

export interface DrumKitDialogHostProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** The part the user is "on", inferred from the current selection. */
function preferredPartFromSelection(selection: ReturnType<typeof useSelection>): number | undefined {
  switch (selection.kind) {
    case "single":
      return extractPartIndex(selection.elementId);
    case "range":
      return extractPartIndex(selection.startElementId);
    case "multi":
      return selection.elementIds[0] ? extractPartIndex(selection.elementIds[0]) : undefined;
    case "measure":
      return selection.startPartIndex;
    default:
      return undefined;
  }
}

/**
 * Connects {@link DrumKitDialog} to the live editor: resolves which percussion
 * part to edit (from the selection, else the first percussion part), reads its
 * kit into editable rows, persists edits via `updateScore`, and auditions
 * sounds through the playback sampler.
 */
export function DrumKitDialogHost({ open, onClose }: DrumKitDialogHostProps) {
  const score = useDocumentStore((s) => s.score);
  const { updateScore } = useDocumentActions();
  const selection = useSelection();
  const { previewNote } = usePlaybackActions();
  // An explicit target part (set by the per-part "Edit Drum Kit…" command or
  // after adding a drum-kit instrument) wins over selection-derived resolution.
  const explicitPartIndex = useDrumKitTargetStore((s) => s.partIndex);
  const reviewNotice = useDrumKitTargetStore((s) => s.reviewReason);

  const partIndex = useMemo(() => {
    if (!score) return null;
    if (explicitPartIndex !== null && isPercussionPart(score.parts[explicitPartIndex])) {
      return explicitPartIndex;
    }
    return findPercussionPartIndex(score, preferredPartFromSelection(selection));
  }, [score, explicitPartIndex, selection]);

  // Clear the explicit target when the dialog closes so the next open without
  // a target falls back to the selection again.
  const handleClose = useCallback(() => {
    if (advanceDrumKitReview()) return;
    clearDrumKitTarget();
    onClose();
  }, [onClose]);

  // Resolve editable rows only while open, so edits aren't clobbered by
  // unrelated re-renders. `score` is stable during modal editing.
  const target = useMemo(() => {
    if (!open || !score || partIndex === null) return null;
    return resolveDrumKitTarget(score, partIndex);
  }, [open, score, partIndex]);

  const handleApply = useCallback(
    (edits: readonly KitComponentEdit[]) => {
      if (!score || partIndex === null) return;
      updateScore(applyDrumKitEdits(score, partIndex, edits));
    },
    [score, partIndex, updateScore],
  );

  const handlePreview = useCallback(
    (midiKey: number, drumKit: number | undefined) => {
      // `drumKit` (a GS kit program) routes the audition to the same borrowed
      // kit the note plays back on, so previewing a Tam-tam / Big Gong matches
      // the score instead of sounding the default-kit key.
      previewNote(midiKey, partIndex ?? undefined, 100, 500, drumKit);
    },
    [previewNote, partIndex],
  );

  return (
    <DrumKitDialog
      open={open}
      onClose={handleClose}
      target={target}
      onApply={handleApply}
      onPreview={handlePreview}
      reviewNotice={reviewNotice}
    />
  );
}
