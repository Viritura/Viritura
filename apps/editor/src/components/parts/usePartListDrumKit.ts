import { useCallback } from "react";
import type { Score } from "@viritura/core";
import { isPercussionPart } from "../../score/kitInput";
import { openDrumKitEditorForPart } from "../../store/drumKitTargetStore";

export interface PartListDrumKit {
  /** True when the part is unpitched percussion (has a kit to edit). */
  isPercussionPartId: (partId: string) => boolean;
  /** Open the Drum Kit editor targeting the given part. */
  onEditDrumKit: (partId: string) => void;
}

/** Per-part "Edit Drum Kit…" command wiring for the part list context menu.
 *  Offered only for percussion parts; opens the editor targeting that part.
 *  Returned keys match the `usePartListContextMenus` props so the result can
 *  be spread directly. */
export function usePartListDrumKit(score: Score | null | undefined): PartListDrumKit {
  const isPercussionPartId = useCallback(
    (partId: string) => isPercussionPart(score?.parts.find((p) => p.id === partId)),
    [score],
  );
  const onEditDrumKit = useCallback(
    (partId: string) => {
      const idx = score?.parts.findIndex((p) => p.id === partId) ?? -1;
      if (idx >= 0) openDrumKitEditorForPart(idx);
    },
    [score],
  );
  return { isPercussionPartId, onEditDrumKit };
}
