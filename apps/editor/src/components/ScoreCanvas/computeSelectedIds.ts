import type { Score } from "@viritura/core";
import type { SpatialIndex } from "@viritura/renderer";
import { resolveRangeElementIds } from "../../store/selectionUtils";
import type { Selection } from "../../store/selectionStore";

/**
 * Compute the flat set of element IDs implied by a `Selection`. Pure of refs
 * — caller passes the spatial-index/score snapshots needed to resolve
 * `measure` / `range` selections.
 */
export function computeSelectedIds(
  selection: Selection,
  spatialIndex: SpatialIndex | null,
  score: Score | null,
): Set<string> {
  const ids = new Set<string>();
  if (selection.kind === "single") {
    ids.add(selection.elementId);
    return ids;
  }
  if (selection.kind === "multi") {
    for (const id of selection.elementIds) ids.add(id);
    return ids;
  }
  if (selection.kind === "measure") {
    addMeasureSelectionIds(selection, spatialIndex, ids);
    return ids;
  }
  if (selection.kind === "range") {
    addRangeSelectionIds(selection, score, ids);
    return ids;
  }
  return ids;
}

function addMeasureSelectionIds(
  selection: Extract<Selection, { kind: "measure" }>,
  si: SpatialIndex | null,
  ids: Set<string>,
): void {
  if (!si) return;
  const startM = Math.min(selection.startMeasure, selection.endMeasure);
  const endM = Math.max(selection.startMeasure, selection.endMeasure);
  const startP = Math.min(selection.startPartIndex, selection.endPartIndex);
  const endP = Math.max(selection.startPartIndex, selection.endPartIndex);
  for (const entry of si.all) {
    const pMatch = entry.id.match(/^p(\d+)\/m(\d+)\//);
    if (!pMatch) continue;
    const p = parseInt(pMatch[1]!, 10);
    const m = parseInt(pMatch[2]!, 10);
    if (p < startP || p > endP || m < startM || m > endM) continue;
    // Skip per-notehead sub-bboxes (n0, n1...)
    if (/\/n\d+$/.test(entry.id)) continue;
    ids.add(entry.id);
  }
}

function addRangeSelectionIds(
  selection: Extract<Selection, { kind: "range" }>,
  score: Score | null,
  ids: Set<string>,
): void {
  if (score) {
    const rangeIds = resolveRangeElementIds(selection.startElementId, selection.endElementId, score);
    for (const id of rangeIds) ids.add(id);
  }
  // Always ensure start and end are included
  ids.add(selection.startElementId);
  ids.add(selection.endElementId);
}
