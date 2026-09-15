import type { Score } from "@viritura/core";
import { hitTestBeamInk, selectionGroupMembers, type DisplayList } from "@viritura/renderer";
import { expandCondensedEventElementIds } from "../../score/condensedWriteback";
import type { MeasureSelectionPoint } from "../../store/selectionStore";

interface BeamSelectionArgs {
  displayList: DisplayList | null;
  score: Score | null;
  selectedScoreIndex: number;
  x: number;
  y: number;
  zoom: number;
  toggle: boolean;
  measureAnchor: MeasureSelectionPoint | null;
  selectElements: (ids: readonly string[], measureAnchor?: MeasureSelectionPoint) => void;
  toggleSelection: (id: string) => void;
}

/** Select the exact source events represented by beam ink at the pointer. */
export function selectBeamAtPoint(args: BeamSelectionArgs): boolean {
  const beamId = hitTestBeamInk(args.displayList, args.x, args.y, 2 / args.zoom);
  if (!beamId) return false;
  const members = selectionGroupMembers(args.displayList, beamId);
  const selectionMembers = args.measureAnchor?.isExpansion
    ? members
    : args.score
      ? expandCondensedEventElementIds(args.score, members, args.selectedScoreIndex)
      : members;
  if (selectionMembers.length === 0) return false;
  if (args.toggle) {
    for (const member of selectionMembers) args.toggleSelection(member);
  } else {
    args.selectElements(selectionMembers, args.measureAnchor ?? undefined);
  }
  return true;
}
