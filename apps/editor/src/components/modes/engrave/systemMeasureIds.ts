interface SystemBounds {
  measureBounds?: { measureId?: string; systemIndex?: number; x: number }[];
}

/**
 * Measure ids of the rendered system that contains `systemMeasureId`, in
 * left-to-right order. Falls back to the given id when no layout is available.
 */
export function systemMeasureIdsAt(displayList: SystemBounds | null, systemMeasureId: string): string[] {
  const bounds = displayList?.measureBounds ?? [];
  const anchor = bounds.find((bound) => bound.measureId === systemMeasureId);
  if (!anchor) return [systemMeasureId];
  const system = anchor.systemIndex ?? 0;
  const firstX = new Map<string, number>();
  for (const bound of bounds) {
    if ((bound.systemIndex ?? 0) !== system || !bound.measureId) continue;
    firstX.set(bound.measureId, Math.min(firstX.get(bound.measureId) ?? Infinity, bound.x));
  }
  const ids = [...firstX.entries()].sort(([, a], [, b]) => a - b).map(([id]) => id);
  return [systemMeasureId, ...ids.filter((id) => id !== systemMeasureId)];
}
