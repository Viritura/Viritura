import { useCallback, useState, type ReactNode } from "react";
import type { PartDisplayInfo, Score } from "@viritura/core";
import { ScoreMembershipDialog, type ScoreMembershipMode } from "./ScoreMembershipDialog";

interface UseScoreMembershipDialogArgs {
  score: Score | null;
  partDisplayMap: Map<string, PartDisplayInfo>;
  onCreateSectionScore?: (partIds: readonly string[], name?: string) => void;
  onSetScoreMembership?: (scoreIndex: number, partIds: readonly string[]) => void;
}

interface DialogState {
  mode: ScoreMembershipMode;
  scoreIndex?: number;
}

export interface UseScoreMembershipDialogResult {
  /** Open the "new section score" picker. */
  openSectionDialog: () => void;
  /** Open the "manage instruments" picker for an existing score. */
  openManageDialog: (scoreIndex: number) => void;
  /** The dialog element to render (null when no score). */
  dialogElement: ReactNode;
}

/**
 * Owns the open-state and rendering of {@link ScoreMembershipDialog} so the
 * host panel stays small. Both entry points (Add Score → Section, and a score's
 * "Manage Instruments…" menu item) drive the same dialog in different modes.
 */
export function useScoreMembershipDialog({
  score,
  partDisplayMap,
  onCreateSectionScore,
  onSetScoreMembership,
}: UseScoreMembershipDialogArgs): UseScoreMembershipDialogResult {
  const [state, setState] = useState<DialogState | null>(null);

  const openSectionDialog = useCallback(() => setState({ mode: "section" }), []);
  const openManageDialog = useCallback((scoreIndex: number) => setState({ mode: "manage", scoreIndex }), []);
  const close = useCallback(() => setState(null), []);

  const dialogElement =
    score && state ? (
      <ScoreMembershipDialog
        open
        mode={state.mode}
        score={score}
        partDisplayMap={partDisplayMap}
        scoreIndex={state.scoreIndex}
        onClose={close}
        onCreateSection={(partIds, name) => onCreateSectionScore?.(partIds, name)}
        onSetMembership={(scoreIndex, partIds) => onSetScoreMembership?.(scoreIndex, partIds)}
      />
    ) : null;

  return { openSectionDialog, openManageDialog, dialogElement };
}
