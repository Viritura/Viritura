/**
 * Drum-kit editor target store.
 *
 * Kits are a per-part property, so the Drum Kit editor needs to know *which*
 * percussion part to edit. This holds the score-parts index of the part to
 * target when the dialog opens — set by the per-part "Edit Drum Kit…" command
 * (part context menu) or right after adding a drum-kit instrument.
 *
 * When the index is `null` the {@link DrumKitDialogHost} falls back to resolving
 * the part from the current selection (its legacy behavior).
 */

import { create } from "zustand";
import { openDialog } from "./dialogStore";

export interface DrumKitTargetState {
  /** Index into `score.parts` of the part to edit, or null to fall back to
   *  the selection-derived part. */
  partIndex: number | null;
  reviewQueue: number[];
  reviewReason: string | null;
  reviewReasonQueue: string[];
}

export const useDrumKitTargetStore = create<DrumKitTargetState>(() => ({
  partIndex: null,
  reviewQueue: [],
  reviewReason: null,
  reviewReasonQueue: [],
}));

/** Open the Drum Kit editor targeting a specific part (by `score.parts` index). */
export const openDrumKitEditorForPart = (partIndex: number): void => {
  useDrumKitTargetStore.setState({ partIndex, reviewQueue: [], reviewReason: null, reviewReasonQueue: [] });
  openDialog("drumKit");
};

/** Review imported percussion maps sequentially in the shared editor. */
export const openPercussionReviewForParts = (partIndices: readonly number[], reasons: readonly string[] = []): void => {
  const [first, ...rest] = partIndices;
  if (first === undefined) return;
  useDrumKitTargetStore.setState({
    partIndex: first,
    reviewQueue: rest,
    reviewReason: reasons[0] ?? "This percussion map was inferred heuristically from MusicXML.",
    reviewReasonQueue: reasons.slice(1),
  });
  openDialog("drumKit");
};

/** Advance an import-review queue. Returns true when another target is ready. */
export const advanceDrumKitReview = (): boolean => {
  const { reviewQueue, reviewReasonQueue } = useDrumKitTargetStore.getState();
  const [next, ...rest] = reviewQueue;
  if (next === undefined) return false;
  useDrumKitTargetStore.setState({
    partIndex: next,
    reviewQueue: rest,
    reviewReason: reviewReasonQueue[0] ?? "This percussion map was inferred heuristically from MusicXML.",
    reviewReasonQueue: reviewReasonQueue.slice(1),
  });
  return true;
};

/** Clear the explicit target (e.g. when the dialog closes). */
export const clearDrumKitTarget = (): void => {
  useDrumKitTargetStore.setState({
    partIndex: null,
    reviewQueue: [],
    reviewReason: null,
    reviewReasonQueue: [],
  });
};
