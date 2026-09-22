import type { Score } from "@viritura/core";
import { Button } from "@viritura/ui";
import { resolveChordSymbolTarget } from "../../app/useAppKeyboardWiring";
import { useSelection } from "../../store/selectionStore";
import { useViewStateStore } from "../../store/viewStateStore";
import { setChordSymbolPopover } from "../../store/overlayStore";

export function ChordSymbolEntryAction({ score }: { score: Score | null }) {
  const selection = useSelection();
  const selectedScoreIndex = useViewStateStore((state) => state.selectedScoreIndex);
  const target = score ? resolveChordSymbolTarget(score, selection, selectedScoreIndex, { x: 0, y: 0 }) : null;
  if (!target) return null;
  return (
    <Button
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setChordSymbolPopover({ ...target, position: { x: rect.left, y: rect.bottom } });
      }}
    >
      Add chord symbol
    </Button>
  );
}
