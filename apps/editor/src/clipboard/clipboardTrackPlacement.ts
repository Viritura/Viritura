import {
  DURATION_BEATS,
  isRest,
  type Duration,
  type SequenceContent,
  type Space,
  type TupletDuration,
} from "@viritura/core";
import { decomposeDuration, generateEventId, sequenceContentBeats } from "../commands/noteCommands";

function checkedFraction([numerator, denominator]: Space["duration"]): [bigint, bigint] {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator <= 0) {
    throw new Error("Cannot represent clipboard timing exactly.");
  }
  return [BigInt(numerator), BigInt(denominator)];
}

function reducedFraction(numerator: bigint, denominator: bigint): Space["duration"] {
  let a = numerator;
  let b = denominator;
  while (b !== 0n) [a, b] = [b, a % b];
  const fraction: Space["duration"] = [Number(numerator / a), Number(denominator / a)];
  checkedFraction(fraction);
  return fraction;
}

export function addWholeFractions(left: Space["duration"], right: Space["duration"]): Space["duration"] {
  const [a, b] = checkedFraction(left);
  const [c, d] = checkedFraction(right);
  return reducedFraction(a * d + c * b, b * d);
}

export function subtractWholeFractions(left: Space["duration"], right: Space["duration"]): Space["duration"] {
  const [a, b] = checkedFraction(left);
  const [c, d] = checkedFraction(right);
  if (a * d < c * b) throw new Error("Cannot represent negative clipboard timing exactly.");
  return reducedFraction(a * d - c * b, b * d);
}

export function compareWholeFractions(left: Space["duration"], right: Space["duration"]): number {
  const [a, b] = checkedFraction(left);
  const [c, d] = checkedFraction(right);
  const difference = a * d - c * b;
  return difference < 0n ? -1 : Number(difference > 0n);
}

function multiplyWholeFractions(left: Space["duration"], right: Space["duration"]): Space["duration"] {
  const [a, b] = checkedFraction(left);
  const [c, d] = checkedFraction(right);
  return reducedFraction(a * c, b * d);
}

function durationWholeFraction(duration: Duration): Space["duration"] {
  let total = exactWholeFraction(DURATION_BEATS[duration.base]);
  let dot = total;
  const dots = duration.dots ?? 0;
  checkedFraction([dots, 1]);
  for (let index = 0; index < dots; index++) {
    dot = multiplyWholeFractions(dot, [1, 2]);
    total = addWholeFractions(total, dot);
  }
  return total;
}

function tupletDurationWholeFraction(duration: TupletDuration): Space["duration"] {
  return multiplyWholeFractions(durationWholeFraction(duration.duration), [duration.multiple, 1]);
}

export function contentWholeFraction(item: SequenceContent): Space["duration"] {
  switch (item.type) {
    case "event":
      return durationWholeFraction(item.duration);
    case "tuplet": {
      const outer = tupletDurationWholeFraction(item.outer);
      if (!item.span) return outer;
      const inner = tupletDurationWholeFraction(item.inner);
      const local = item.content.reduce<Space["duration"]>(
        (sum, child) => addWholeFractions(sum, contentWholeFraction(child)),
        [0, 1],
      );
      // A spanning fragment occupies only its local content scaled by the full ratio.
      // Keep both exact: float accumulation would turn roundoff into new notation.
      const ratio = multiplyWholeFractions(outer, [inner[1], inner[0]]);
      return multiplyWholeFractions(local, ratio);
    }
    case "tremolo":
      return tupletDurationWholeFraction(item.outer);
    case "grace":
      return [0, 1];
    case "space":
      checkedFraction(item.duration);
      return item.duration;
  }
}

function binaryFraction(value: number): [bigint, bigint] {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const significand = (bits & ((1n << 52n) - 1n)) | (exponent === 0 ? 0n : 1n << 52n);
  const power = (exponent === 0 ? -1022 : exponent - 1023) - 52;
  return [significand << BigInt(Math.max(0, power)), 1n << BigInt(Math.max(0, -power))];
}

/** Recover a fraction that round-trips to the numeric beat, without imposing a rhythmic grid. */
export function exactWholeFraction(quarterBeats: number): Space["duration"] {
  if (!Number.isFinite(quarterBeats) || quarterBeats < 0) {
    throw new Error("Cannot represent clipboard timing exactly.");
  }
  if (quarterBeats === 0) return [0, 1];
  let [dividend, divisor] = binaryFraction(quarterBeats / 4);
  let numerator = 1n;
  let denominator = 0n;
  let previousNumerator = 0n;
  let previousDenominator = 1n;
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  while (divisor !== 0n) {
    const coefficient = dividend / divisor;
    let bounded = coefficient;
    if (numerator > 0n) {
      const maxCoefficient = (limit - previousNumerator) / numerator;
      if (bounded > maxCoefficient) bounded = maxCoefficient;
    }
    if (denominator > 0n) {
      const maxCoefficient = (limit - previousDenominator) / denominator;
      if (bounded > maxCoefficient) bounded = maxCoefficient;
    }
    [numerator, previousNumerator] = [bounded * numerator + previousNumerator, numerator];
    [denominator, previousDenominator] = [bounded * denominator + previousDenominator, denominator];
    const fraction: Space["duration"] = [Number(numerator), Number(denominator)];
    const actual = (fraction[0] / fraction[1]) * 4;
    if (numerator > 0n && actual === quarterBeats) return fraction;
    if (bounded !== coefficient) break;
    [dividend, divisor] = [divisor, dividend % divisor];
  }
  throw new Error("Cannot represent clipboard timing exactly.");
}

export function sequenceBoundaryFraction(
  content: readonly SequenceContent[],
  targetBeat: number,
): Space["duration"] | undefined {
  let onset = 0;
  let boundary: Space["duration"] | undefined;
  for (let index = 0; index <= content.length; index++) {
    if (onset === targetBeat) {
      const fraction = content
        .slice(0, index)
        .reduce<Space["duration"]>((sum, item) => addWholeFractions(sum, contentWholeFraction(item)), [0, 1]);
      if (boundary && compareWholeFractions(boundary, fraction) !== 0) {
        throw new Error("Cannot determine exact clipboard timing from an ambiguous numeric boundary.");
      }
      boundary = fraction;
    }
    if (onset > targetBeat || index === content.length) break;
    onset += sequenceContentBeats(content[index]!);
  }
  return boundary;
}

export function splitSequenceAtBeat(
  content: SequenceContent[],
  targetBeat: number,
  targetFraction?: Space["duration"],
): void {
  const target = targetFraction ?? sequenceBoundaryFraction(content, targetBeat) ?? exactWholeFraction(targetBeat);
  let onset: Space["duration"] = [0, 1];
  for (let index = 0; index < content.length; index++) {
    const item = content[index]!;
    const end = addWholeFractions(onset, contentWholeFraction(item));
    if (compareWholeFractions(target, onset) <= 0 || compareWholeFractions(target, end) >= 0) {
      onset = end;
      continue;
    }
    const before = subtractWholeFractions(target, onset);
    const after = subtractWholeFractions(end, target);
    if (item.type === "space") {
      content.splice(index, 1, { type: "space", duration: before }, { type: "space", duration: after });
      return;
    }
    if (item.type !== "event" || !isRest(item)) {
      throw new Error("The destination voice must have a rhythmic boundary at the clipboard voice offset.");
    }
    const rests = [...exactRestDurations(before), ...exactRestDurations(after)].map((durationValue) => ({
      type: "event" as const,
      id: generateEventId(),
      duration: durationValue,
      rest: {},
    }));
    content.splice(index, 1, ...rests);
    return;
  }
}

export function ensureSequencePosition(
  content: SequenceContent[],
  targetBeat: number,
  targetFraction?: Space["duration"],
): void {
  const existing = content.reduce<Space["duration"]>(
    (sum, item) => addWholeFractions(sum, contentWholeFraction(item)),
    [0, 1],
  );
  const target = targetFraction ?? sequenceBoundaryFraction(content, targetBeat) ?? exactWholeFraction(targetBeat);
  if (compareWholeFractions(existing, target) >= 0) return;
  content.push({
    type: "space",
    duration: subtractWholeFractions(target, existing),
  });
}

function exactRestDurations(fraction: Space["duration"]): Duration[] {
  const durations = decomposeDuration((fraction[0] / fraction[1]) * 4);
  const actual = durations.reduce<Space["duration"]>(
    (sum, duration) => addWholeFractions(sum, durationWholeFraction(duration)),
    [0, 1],
  );
  if (compareWholeFractions(fraction, actual) !== 0) {
    throw new Error("Cannot represent the destination voice offset exactly.");
  }
  return durations;
}
