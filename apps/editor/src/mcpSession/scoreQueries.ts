import type { Score } from "@viritura/core";
import { serializeMnx } from "@viritura/format";
import { extractMeasureIndex, extractPartIndex } from "../score/ElementPath";
import type { SelectionState } from "../store/selectionStore";

interface MeasureQuery {
  readonly startMeasure?: unknown;
  readonly endMeasure?: unknown;
  readonly partIds?: unknown;
}

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
  const input = isObject(args) ? (args as MeasureQuery) : {};
  const startMeasure = readMeasureNumber(input.startMeasure, 1, score.global.measures.length);
  const endMeasure = readMeasureNumber(
    input.endMeasure,
    Math.min(startMeasure + 7, score.global.measures.length),
    score.global.measures.length,
  );
  if (endMeasure < startMeasure) throw new Error("endMeasure must be greater than or equal to startMeasure.");
  if (endMeasure - startMeasure + 1 > 32) throw new Error("A measure query may return at most 32 measures.");

  const requestedPartIds = readPartIds(input.partIds);
  const serialized = serializeMnx(score) as unknown as SerializedScore;
  const parts = serialized.parts.filter(
    (part) => requestedPartIds === null || (part.id && requestedPartIds.has(part.id)),
  );
  if (requestedPartIds !== null && parts.length !== requestedPartIds.size) {
    const found = new Set(parts.map((part) => part.id));
    const missing = [...requestedPartIds].filter((id) => !found.has(id));
    throw new Error(`Unknown partIds: ${missing.join(", ")}`);
  }

  const startIndex = startMeasure - 1;
  const endIndex = endMeasure;
  return {
    startMeasure,
    endMeasure,
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

function readMeasureNumber(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`Measure numbers must be integers from 1 to ${maximum}.`);
  }
  return value as number;
}

function readPartIds(value: unknown): Set<string> | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    throw new Error("partIds must be an array of part ID strings.");
  }
  return new Set(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
