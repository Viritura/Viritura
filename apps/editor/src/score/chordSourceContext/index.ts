import type { Score, LayoutContent, LayoutSource } from "@viritura/core";
import type { MeasureSelectionPoint, RenderedStaffSources } from "../../store/selectionStore";

export function chordViewSources(
  score: Score,
  selectedScoreIndex: number,
  measureIndex: number,
  selectedPartIds: readonly string[],
): LayoutSource[][] {
  const definition = score.scores?.[selectedScoreIndex];
  let inheritedLayout = definition?.layout;
  let layoutId = inheritedLayout;
  for (const system of definition?.pages?.flatMap((page) => page.systems) ?? []) {
    const start = score.global.measures.findIndex((measure) => measure.id === system.measure);
    if (start < 0 || start > measureIndex) continue;
    inheritedLayout = system.layout ?? inheritedLayout;
    layoutId = inheritedLayout;
    for (const change of system.layoutChanges ?? []) {
      const index = score.global.measures.findIndex((measure) => measure.id === change.location.measure);
      if (index >= start && index <= measureIndex) layoutId = change.layout;
    }
  }
  const layout = score.layouts?.find((item) => item.id === layoutId);
  const sources = (content: LayoutContent[]): LayoutSource[][] =>
    content.flatMap((node) => (node.type === "group" ? sources(node.content) : [node.sources]));
  const visible = layout ? sources(layout.content) : [];
  if (!selectedPartIds.length) return visible;
  const filtered = visible
    .map((staff) => staff.filter((source) => selectedPartIds.includes(source.part)))
    .filter((staff) => staff.length > 0);
  return filtered.length ? filtered : selectedPartIds.map((part) => [{ part }]);
}

export function anchoredChordSources(
  score: Score,
  anchor: MeasureSelectionPoint,
  staves: LayoutSource[][],
  rendered: RenderedStaffSources,
): LayoutSource[] | undefined {
  const part = score.parts[anchor.partIndex];
  if (!part) return undefined;
  const mapped = rendered?.find(
    (staff) => staff.staffIndex === anchor.staffIndex && staff.measureIndex === anchor.measureIndex,
  );
  if (rendered && !mapped) return undefined;
  const candidates = staves.filter((staff) => staff.some((source) => source.part === part.id));
  // A rendered staff can be expanded or split; only an unambiguous authored
  // source match can supply its original staff number.
  if (mapped) {
    const matching = staves.filter((staff) => mapped.partIds.every((id) => staff.some((source) => source.part === id)));
    const renderedPeers = rendered!
      .filter(
        (staff) =>
          staff.measureIndex === anchor.measureIndex &&
          staff.partIds.length === mapped.partIds.length &&
          staff.partIds.every((id) => mapped.partIds.includes(id)),
      )
      .sort((left, right) => left.staffIndex - right.staffIndex);
    const authored = matching.length === renderedPeers.length ? matching[renderedPeers.indexOf(mapped)] : undefined;
    const sources = (authored ?? matching.flat()).filter((source) => mapped.partIds.includes(source.part));
    const unique = sources.filter(
      (source, index) =>
        sources.findIndex((other) => other.part === source.part && (other.staff ?? 1) === (source.staff ?? 1)) ===
        index,
    );
    if (!unique.length && mapped.partIds.length === 1 && !staves.length) {
      const sourcePart = score.parts.find((item) => item.id === mapped.partIds[0]);
      if (sourcePart) return [{ part: mapped.partIds[0]!, staff: renderedPeers.indexOf(mapped) + 1 }];
    }

    if (unique.length !== mapped.partIds.length) return undefined;
    return mapped.partIds.map((id) => unique.find((source) => source.part === id)!);
  }
  if (candidates.length) return candidates[anchor.localStaffIndex ?? 0];
  return part.id ? [{ part: part.id, staff: (anchor.localStaffIndex ?? 0) + 1 }] : undefined;
}

/** Resolve a displayed staff ordinal to the authored staff of its source part. */
export function chordRangeSourceStaff(
  score: Score,
  anchor: MeasureSelectionPoint,
  selectedScoreIndex = 0,
  rendered?: RenderedStaffSources,
): number | undefined {
  const part = score.parts[anchor.partIndex];
  if (!part) return undefined;
  const staves = chordViewSources(score, selectedScoreIndex, anchor.measureIndex, []);
  if (!staves.length && !rendered) {
    return anchor.localStaffIndex !== undefined ? anchor.localStaffIndex + 1 : (part.staves ?? 1) === 1 ? 1 : undefined;
  }
  if (anchor.localStaffIndex === undefined && !rendered) {
    const candidates = staves.flat().filter((source) => source.part === part.id);
    if (new Set(candidates.map((source) => source.staff ?? 1)).size > 1) return undefined;
  }
  const sources = anchoredChordSources(score, anchor, staves, rendered)?.filter((source) => source.part === part.id);
  const staffs = new Set(sources?.map((source) => source.staff ?? 1));
  return staffs.size === 1 ? [...staffs][0] : undefined;
}
