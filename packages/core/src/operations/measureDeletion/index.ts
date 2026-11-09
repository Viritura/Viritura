import type { GlobalMeasure } from "../../model/measure";

/** Remove bars and ramps whose endpoints were deleted, retaining unrelated system text. */
export function removeGlobalMeasures(
  measures: readonly GlobalMeasure[],
  startIndex: number,
  count: number,
): GlobalMeasure[] {
  if (
    !Number.isInteger(startIndex) ||
    startIndex < 0 ||
    startIndex >= measures.length ||
    !Number.isInteger(count) ||
    count <= 0
  ) {
    throw new RangeError("Measure deletion requires an existing start bar and a positive integer count.");
  }
  const endIndex = Math.min(startIndex + count, measures.length);
  const idToIndex = new Map(measures.flatMap((measure, index) => (measure.id ? [[measure.id, index] as const] : [])));
  return measures.flatMap((measure, index) => {
    if (index >= startIndex && index < endIndex) return [];
    const ramp = measure.gradualTempo;
    if (!ramp) return [measure];
    const namedEndpoint = idToIndex.get(ramp.end.measure);
    const endpoint = namedEndpoint ?? (/^\d+$/.test(ramp.end.measure) ? Number(ramp.end.measure) : undefined);
    if (endpoint !== undefined && endpoint >= startIndex && endpoint < endIndex) {
      const { gradualTempo: _ramp, ...remaining } = measure;
      if (ramp.systemTextId && remaining.systemText) {
        remaining.systemText = remaining.systemText.filter((text) => text.id !== ramp.systemTextId);
        if (remaining.systemText.length === 0) delete remaining.systemText;
      }
      return [remaining];
    }
    if (namedEndpoint === undefined && endpoint !== undefined && endpoint >= endIndex) {
      return [
        {
          ...measure,
          gradualTempo: { ...ramp, end: { ...ramp.end, measure: String(endpoint - (endIndex - startIndex)) } },
        },
      ];
    }
    return [measure];
  });
}
