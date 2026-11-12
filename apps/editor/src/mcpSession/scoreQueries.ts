import type { Score } from "@viritura/core";
import { serializeMnx } from "@viritura/format";
import { extractMeasureIndex, extractPartIndex } from "../score/ElementPath";
import type { SelectionState } from "../store/selectionStore";
import { measureReference, resolveMeasureRange } from "./measureReferences";
import { selectParts } from "./queryFilters";

interface SerializedScore {
  readonly global: { readonly measures: readonly unknown[] };
  readonly parts: readonly {
    readonly id?: string;
    readonly name?: string;
    readonly shortName?: string;
    readonly measures: readonly unknown[];
  }[];
}

export function getMeasureSlice(score: Score, args: unknown): Record<string, unknown> {
  const input = isObject(args) ? args : {};
  const { startMeasure, endMeasure } = resolveMeasureRange(score, input, 8, 32);
  const selected = new Set(selectParts(score, input.partIds));
  const serialized = serializeMnx(score) as unknown as SerializedScore;
  const parts = serialized.parts.filter((_, index) => selected.has(score.parts[index]!));

  const startIndex = startMeasure - 1;
  const endIndex = endMeasure;
  return {
    startMeasure,
    endMeasure,
    measureReferences: score.global.measures
      .slice(startIndex, endIndex)
      .map((_, i) => measureReference(score, startIndex + i)),
    globalMeasures: serialized.global.measures.slice(startIndex, endIndex),
    parts: parts.map((part) => ({
      id: part.id ?? null,
      name: part.name ?? "",
      shortName: part.shortName ?? null,
      measures: part.measures.slice(startIndex, endIndex),
    })),
  };
}

export function getSelectionContext(score: Score, selection: SelectionState): Record<string, unknown> {
  const range = selectionMeasureRange(score, selection);
  return {
    selection,
    music: range
      ? getMeasureSlice(score, {
          startMeasure: range.startMeasure + 1,
          endMeasure: range.endMeasure + 1,
          partIds: range.partIds,
        })
      : null,
  };
}

function selectionMeasureRange(
  score: Score,
  selection: SelectionState,
): {
  startMeasure: number;
  endMeasure: number;
  partIds?: string[];
} | null {
  if (selection.kind === "measure") {
    const firstPart = Math.min(selection.startPartIndex, selection.endPartIndex);
    const lastPart = Math.max(selection.startPartIndex, selection.endPartIndex);
    return {
      startMeasure: Math.min(selection.startMeasure, selection.endMeasure),
      endMeasure: Math.max(selection.startMeasure, selection.endMeasure),
      partIds: score.parts.slice(firstPart, lastPart + 1).flatMap((part) => (part.id ? [part.id] : [])),
    };
  }
  const ids =
    selection.kind === "single"
      ? [selection.elementId]
      : selection.kind === "range"
        ? [selection.startElementId, selection.endElementId]
        : selection.kind === "multi"
          ? [...selection.elementIds]
          : [];
  const measures = ids.map(extractMeasureIndex).filter((value): value is number => value !== null);
  const parts = ids.map(extractPartIndex).filter((value): value is number => value !== null);
  if (measures.length === 0) return null;
  return {
    startMeasure: Math.min(...measures),
    endMeasure: Math.max(...measures),
    partIds: [...new Set(parts)].flatMap((index) => {
      const partId = score.parts[index]?.id;
      return partId ? [partId] : [];
    }),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
