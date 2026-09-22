/**
 * Turning a selection into a distribution plan.
 *
 * Explode and reduce differ only in how they derive targets from the selected
 * staves, so both resolve to the same `redistributeStaves` call:
 *
 * - **Explode** keeps the selected staves as targets and, when the music is
 *   thicker than the selection is tall, annexes staves below it until the
 *   widest simultaneity fits. A single-staff selection therefore fans out; a
 *   selection that already spans enough staves redistributes in place.
 * - **Reduce** collapses onto the topmost selected staff and rests the others.
 * - **Redistribute** re-lays the selected staves across themselves, which is
 *   the many-to-many case (re-balancing an existing divisi).
 */

import type { Score } from "@viritura/core";
import type { Selection } from "../../store/selectionStore";
import { resolveSelectionScope } from "../../store/selectionUtils";
import { buildBeatGrid, maxSimultaneity } from "./beatGrid";
import { redistributeStaves, type RedistributeResult } from "./redistribute";
import { extendStavesDownward, selectionStaffRefs, type StaffRef } from "./staffOrder";

export type DistributionMode = "explode" | "reduce" | "redistribute";

interface DistributionPlan {
  mode: DistributionMode;
  sources: StaffRef[];
  targets: StaffRef[];
  startMeasure: number;
  endMeasure: number;
  /** Notes in the widest simultaneity that could not be given their own staff. */
  overflow: number;
}

function resolveTargets(score: Score, mode: DistributionMode, sources: StaffRef[], required: number): StaffRef[] {
  switch (mode) {
    case "explode":
      return extendStavesDownward(score, sources, required);
    case "reduce":
      return sources.slice(0, 1);
    case "redistribute":
      return sources;
  }
}

/**
 * Describe what a distribution would do, without touching the score. Returns
 * null when the selection cannot anchor one (no staves, or no measure scope).
 */
function planDistribution(score: Score, selection: Selection, mode: DistributionMode): DistributionPlan | null {
  const sources = selectionStaffRefs(score, selection);
  const scope = resolveSelectionScope(selection, score);
  if (sources.length === 0 || !scope) return null;

  const { startMeasure, endMeasure } = scope;
  const required = maxSimultaneity(buildBeatGrid(score, sources, startMeasure, endMeasure));
  const targets = resolveTargets(score, mode, sources, required);
  return {
    mode,
    sources,
    targets,
    startMeasure,
    endMeasure,
    overflow: Math.max(0, required - targets.length),
  };
}

const OVERFLOW_NOTE = "; extra notes were stacked on the last staff";

/** Run a distribution for the current selection. Returns null when it cannot apply. */
export function applyDistribution(
  score: Score,
  selection: Selection,
  mode: DistributionMode,
): RedistributeResult | null {
  const plan = planDistribution(score, selection, mode);
  if (!plan) return null;
  const result = redistributeStaves(score, plan);
  if (plan.overflow > 0 && result.changed) {
    const staves = plan.targets.length === 1 ? "1 staff" : `${plan.targets.length} staves`;
    result.warnings.push(`Only ${staves} were available for distribution${OVERFLOW_NOTE}.`);
  }
  return result;
}
