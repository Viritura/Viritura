import type { LayoutContent, Score } from "@viritura/core";
import { getActiveLayoutId } from "../../score/condensingRouter";
import type { RenderedStaffSources, SelectionState } from "../../store/selectionStore";
import { resolveSelectionScope } from "../../store/selectionUtils";

/** Whole-measure playback targets source parts, not individual displayed staves. */
export function computeSelectionPartIds(
  selection: SelectionState,
  score: Score | null,
  selectedScoreIndex = 0,
  selectedPartIds: readonly string[] = [],
  renderedStaffSources?: RenderedStaffSources,
): readonly string[] | null {
  if (!score || selection.kind !== "measure") return null;
  if (renderedStaffSources) {
    const startStaff = Math.min(selection.startStaffIndex, selection.endStaffIndex);
    const endStaff = Math.max(selection.startStaffIndex, selection.endStaffIndex);
    const startMeasure = Math.min(selection.startMeasure, selection.endMeasure);
    const endMeasure = Math.max(selection.startMeasure, selection.endMeasure);
    const selectedIds = new Set(
      renderedStaffSources
        .filter(
          ({ staffIndex, measureIndex }) =>
            staffIndex >= startStaff &&
            staffIndex <= endStaff &&
            measureIndex >= startMeasure &&
            measureIndex <= endMeasure,
        )
        .flatMap(({ partIds }) => partIds),
    );
    const partIds = score.parts.flatMap((part) => (part.id && selectedIds.has(part.id) ? [part.id] : []));
    return partIds.length > 0 ? [...new Set(partIds)] : null;
  }
  const layoutId = getActiveLayoutId(score, selectedScoreIndex);
  const layout = layoutId ? score.layouts?.find((candidate) => candidate.id === layoutId) : undefined;
  // Multi-part views retain a staff if any of its sources is shown, including
  // all sources of a retained condensed staff, just like the canvas projection.
  const filteredParts = selectedPartIds.length >= 1 ? new Set(selectedPartIds) : null;
  if (layout || filteredParts) {
    const startStaff = Math.min(selection.startStaffIndex, selection.endStaffIndex);
    const endStaff = Math.max(selection.startStaffIndex, selection.endStaffIndex);
    const selectedIds = new Set<string>();
    let staffIndex = 0;
    const visit = (content: readonly LayoutContent[]) => {
      for (const node of content) {
        if (node.type === "group") {
          visit(node.content);
          continue;
        }
        if (filteredParts && !node.sources.some((source) => filteredParts.has(source.part))) continue;
        if (staffIndex >= startStaff && staffIndex <= endStaff) {
          for (const source of node.sources) selectedIds.add(source.part);
        }
        staffIndex += 1;
      }
    };
    visit(layout?.content ?? selectedPartIds.map((part) => ({ type: "staff", sources: [{ part }] })));
    // Return canonical instrument IDs (all their staves/voices), in source order.
    const partIds = score.parts.flatMap((part) => (part.id && selectedIds.has(part.id) ? [part.id] : []));
    return partIds.length > 0 ? [...new Set(partIds)] : null;
  }
  // Scores without an active layout use the source-order projection.
  const scope = resolveSelectionScope(selection, score);
  if (!scope) return null;
  const partIds = score.parts.flatMap((part, index) =>
    index >= scope.startPart && index <= scope.endPart && part.id ? [part.id] : [],
  );
  return partIds.length > 0 ? [...new Set(partIds)] : null;
}
