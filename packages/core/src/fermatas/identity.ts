import type { Fermata, GlobalFermata, RhythmicPosition } from "../model";

export function fermataPositionKey(position: RhythmicPosition): string {
  const [num, den] = position.fraction;
  if (!Number.isSafeInteger(num) || num < 0 || !Number.isSafeInteger(den) || den <= 0) {
    throw new RangeError("Fermata positions require a non-negative integer numerator and positive denominator.");
  }
  let a = num;
  let b = den;
  while (b) [a, b] = [b, a % b];
  return `${num / a}/${den / a}`;
}

/** Lowest identity wins independently of insertion/CRDT order, including settings. */
export function canonicalGlobalFermatas(fermatas: readonly GlobalFermata[] = []): GlobalFermata[] {
  const byPosition = new Map<string, GlobalFermata>();
  for (const fermata of fermatas) {
    if (!fermata.id || !Number.isFinite(fermata.multiplier ?? 2) || (fermata.multiplier ?? 2) < 1) {
      throw new RangeError("Global fermatas require an identity and a finite multiplier of at least 1.");
    }
    const key = fermataPositionKey(fermata.position);
    const previous = byPosition.get(key);
    if (!previous || fermata.id < previous.id) byPosition.set(key, fermata);
  }
  return [...byPosition.values()].sort(
    (a, b) => a.position.fraction[0] / a.position.fraction[1] - b.position.fraction[0] / b.position.fraction[1],
  );
}

export function fermataMultiplier(fermata: Fermata | undefined): number {
  switch (fermata?.duration) {
    case "none":
      return 1;
    case "veryShort":
      return 1.25;
    case "short":
      return 1.5;
    case "long":
      return 2.5;
    case "veryLong":
      return 3;
    default:
      return 2;
  }
}
