import type { Score } from "@viritura/core";
import { buildNavigationIndex, getEntry, type NavigationEntry } from "../../navigation/NavigationIndex";
import { canonicalChordSymbolId, getEventAncestorId, resolveAnnotationLocation } from "../../score/ElementPath";
import { isMeasureLevel } from "../../score/elementTypes";
import { chordRangeSourceStaff } from "../../score/chordSourceContext";
import type { MeasureSelectionPoint } from "../selectionStore";
import type { MeasureRange } from "../selectionUtils";

interface SourceStaff {
  partIndex: number;
  staff: number;
}

export interface ChordRange {
  range: MeasureRange;
  selectedIds: Set<string>;
  chordSources: ReadonlyMap<string, SourceStaff>;
}

function validSource(score: Score, source: SourceStaff): boolean {
  const part = score.parts[source.partIndex];
  return !!part && Number.isInteger(source.staff) && source.staff >= 1 && source.staff <= (part.staves ?? 1);
}

function entrySource(score: Score, entry: NavigationEntry): SourceStaff | undefined {
  const measure = score.parts[entry.partIndex]?.measures[entry.measureIndex];
  if (!measure) return undefined;
  const sequence = measure.sequences[entry.sequenceIndex];
  if (sequence) return { partIndex: entry.partIndex, staff: sequence.staff ?? 1 };
  const location = resolveAnnotationLocation(entry.elementId);
  if (location?.type === "dyn" || location?.type === "hairpin") {
    const dynamics = measure.dynamics ?? [];
    const candidates = location.type === "hairpin" ? dynamics.filter((item) => item.type === "gradual") : dynamics;
    const dynamic = location.annotationId
      ? dynamics.find((item) => item.id === location.annotationId)
      : candidates[location.annotationIndex ?? -1];
    if (dynamic) return { partIndex: entry.partIndex, staff: dynamic.staff ?? 1 };
  }
  return (score.parts[entry.partIndex]?.staves ?? 1) === 1 ? { partIndex: entry.partIndex, staff: 1 } : undefined;
}

function anchorSource(
  score: Score,
  anchor: MeasureSelectionPoint,
  other: SourceStaff | undefined,
): SourceStaff | undefined {
  if (anchor.sourceStaff === null) return undefined;
  // Both pointer indices describe displayed rows; authored layouts can show
  // only staff 2, reorder staves, or insert condensed source expansions.
  const staff =
    anchor.sourceStaff ??
    chordRangeSourceStaff(score, anchor) ??
    (anchor.localStaffIndex === undefined && other?.partIndex === anchor.partIndex ? other.staff : undefined);
  return staff === undefined ? undefined : { partIndex: anchor.partIndex, staff };
}

function endpointSources(
  score: Score,
  ids: [string, string],
  entries: [NavigationEntry, NavigationEntry],
  anchor?: MeasureSelectionPoint,
  focus?: MeasureSelectionPoint,
): [SourceStaff, SourceStaff] | null {
  const sources = ids.map((id, index) =>
    canonicalChordSymbolId(id) ? undefined : entrySource(score, entries[index]!),
  );
  // Render-copy suffixes identify display rows, not document source parts.
  // Use pointer source bounds for either endpoint, never the copy's p/staff.
  for (const index of [0, 1] as const) {
    const point = index === 0 ? anchor : focus;
    if (canonicalChordSymbolId(ids[index]) && point) {
      sources[index] = anchorSource(score, point, sources[1 - index]);
      if (!sources[index] || !validSource(score, sources[index])) return null;
    }
  }
  // A canonical chord has no physical ownership. Without a pointer anchor,
  // the other endpoint is the only known source context.
  if (!sources[0] && canonicalChordSymbolId(ids[0])) sources[0] = sources[1];
  if (!sources[1] && canonicalChordSymbolId(ids[1])) sources[1] = sources[0];
  const [start, end] = sources;
  return start && end && validSource(score, start) && validSource(score, end) ? [start, end] : null;
}

function compareSources(left: SourceStaff, right: SourceStaff): number {
  return left.partIndex - right.partIndex || left.staff - right.staff;
}

function compareTime(left: NavigationEntry, right: NavigationEntry): number {
  return left.measureIndex - right.measureIndex || left.sortKey - right.sortKey;
}

/**
 * Resolve chord range endpoints before constructing physical bounds. Undefined
 * means an ordinary range; null means a chord range with no safe source context.
 * Navigation entries and annotation IDs remain canonical and globally owned.
 */
export function resolveChordRange(
  score: Score,
  startId: string,
  endId: string,
  anchor?: MeasureSelectionPoint,
  focus?: MeasureSelectionPoint,
): ChordRange | null | undefined {
  if (!canonicalChordSymbolId(startId) && !canonicalChordSymbolId(endId)) return undefined;
  const navigation = buildNavigationIndex(score);
  const start = getEntry(navigation, getEventAncestorId(startId)) ?? getEntry(navigation, startId);
  const end = getEntry(navigation, getEventAncestorId(endId)) ?? getEntry(navigation, endId);
  if (!start || !end) return null;
  const sources = endpointSources(score, [startId, endId], [start, end], anchor, focus);
  if (!sources) return null;
  const [low, high] = compareSources(sources[0], sources[1]) <= 0 ? sources : [sources[1], sources[0]];
  const [earlier, later] = compareTime(start, end) <= 0 ? [start, end] : [end, start];
  const sequenceIndices = [start, end].flatMap((entry, index) => {
    const source = sources[index]!;
    if (entry.sequenceIndex >= 0) return [entry.sequenceIndex];
    return (score.parts[source.partIndex]?.measures[entry.measureIndex]?.sequences ?? []).flatMap((sequence, i) =>
      (sequence.staff ?? 1) === source.staff ? [i] : [],
    );
  });
  const range: MeasureRange = {
    startMeasure: earlier.measureIndex,
    endMeasure: later.measureIndex,
    startPart: low.partIndex,
    endPart: high.partIndex,
    startVoice: sequenceIndices.length ? Math.min(...sequenceIndices) : 0,
    endVoice: sequenceIndices.length ? Math.max(...sequenceIndices) : 0,
  };
  const selectedIds = new Set(
    navigation.entries
      .filter((entry) => {
        if (entry.elementType !== "event" && entry.elementType !== "rest" && !isMeasureLevel(entry.elementType)) {
          return false;
        }
        if (compareTime(entry, earlier) < -1e-9 || compareTime(entry, later) > 1e-9) return false;
        const source = entrySource(score, entry);
        return source !== undefined && compareSources(source, low) >= 0 && compareSources(source, high) <= 0;
      })
      .map((entry) => entry.elementId),
  );
  selectedIds.add(startId);
  selectedIds.add(endId);
  const chordSources = new Map(
    ([startId, endId] as const).flatMap((id, index) =>
      canonicalChordSymbolId(id) ? [[id, sources[index]!] as const] : [],
    ),
  );
  return { range, selectedIds, chordSources };
}
