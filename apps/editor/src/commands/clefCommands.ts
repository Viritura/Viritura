import type { PositionedClef, Score } from "@viritura/core";
import { cloneScore } from "../score/scoreClone";
import type { NotationSelectionTarget } from "./notationInspectorCommands";

export interface SelectedClefEntry {
  clefIndex: number;
  clefEntry: PositionedClef;
}

export function resolveSelectedClefEntry(
  score: Score,
  target: Pick<NotationSelectionTarget, "elementType" | "partIndex" | "measureIndex" | "clefIndex">,
): SelectedClefEntry | null {
  if (target.elementType !== "clef") return null;
  const clefs = score.parts[target.partIndex]?.measures[target.measureIndex]?.clefs;
  if (!clefs || clefs.length === 0) return null;
  const clefIndex = target.clefIndex ?? 0;
  const clefEntry = clefs[clefIndex];
  return clefEntry ? { clefIndex, clefEntry } : null;
}

export function setClefHiddenForSelection(
  score: Score,
  target: Pick<NotationSelectionTarget, "elementType" | "partIndex" | "measureIndex" | "clefIndex">,
  hidden: boolean,
): Score {
  const selected = resolveSelectedClefEntry(score, target);
  if (!selected) return score;
  const { partIndex, measureIndex } = target;
  const next = cloneScore(score);
  const clef = next.parts[partIndex]!.measures[measureIndex]!.clefs![selected.clefIndex]!.clef;
  if (hidden) clef.hide = true;
  else delete clef.hide;
  return next;
}
