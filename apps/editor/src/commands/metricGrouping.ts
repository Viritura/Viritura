import type { ResolvedMeter } from "@viritura/core";

/**
 * Primary metric regions used by automatic notation.
 * Authored groups are authoritative; ordinary even meters expose the half-bar.
 */
export function primaryMetricBoundaries(meter: ResolvedMeter): readonly number[] {
  if (meter.source === "authored") return meter.beatBoundaries;
  const measureDuration = (meter.count * 4) / meter.unit;
  return meter.count % 2 === 0 ? [0, measureDuration / 2, measureDuration] : [0, measureDuration];
}
