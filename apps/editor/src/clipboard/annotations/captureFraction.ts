import { beatPositionToFraction } from "../../app/timedAnnotationPosition";

export function exactCaptureFraction(beats: number, denominator = 1024, roundoff = 0): [number, number] {
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(beats)) * 8 + roundoff;
  const grid: [number, number] = [Math.round((beats / 4) * denominator), denominator];
  const fraction = Math.abs((grid[0] / grid[1]) * 4 - beats) <= tolerance ? grid : beatPositionToFraction(beats);
  // Allow floating-point roundoff, never the converter's rhythmic approximation.
  if (
    !Number.isFinite(beats) ||
    !fraction.every(Number.isSafeInteger) ||
    fraction[1] <= 0 ||
    Math.abs((fraction[0] / fraction[1]) * 4 - beats) > tolerance
  ) {
    throw new Error("Cannot represent clipboard capture timing exactly.");
  }
  return fraction;
}

export function exactCaptureDifference(end: number, start: number, denominator = 1024): [number, number] {
  const roundoff = Number.EPSILON * (Math.abs(end) + Math.abs(start)) * 8;
  return exactCaptureFraction(end - start, denominator, roundoff);
}
