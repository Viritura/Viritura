import { Fraction } from "../fraction";

function decimalFraction(value: number): Fraction {
  const [digits, exponentText] = value.toString().toLowerCase().split("e");
  const places = (digits!.split(".")[1]?.length ?? 0) - Number(exponentText ?? 0);
  const numerator = Number(digits!.replace(".", "")) * 10 ** Math.max(-places, 0);
  const denominator = 10 ** Math.max(places, 0);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new Error("MusicXML duration exceeds exact rational precision");
  }
  return new Fraction(numerator, denominator);
}

/** Durations, offsets, and divisions are decimals; rationalize before converting to whole notes. */
export function durationFraction(duration: number, divisions: number): Fraction {
  if (!Number.isFinite(divisions) || divisions <= 0) throw new Error("Invalid MusicXML divisions");
  const durationValue = decimalFraction(duration);
  const divisionsValue = decimalFraction(divisions);
  // Cross-cancel before multiplication so reducible decimal inputs do not overflow.
  const durationRatio = new Fraction(durationValue.n, divisionsValue.n);
  const decimalScale = new Fraction(divisionsValue.d, durationValue.d);
  const quarterScale = new Fraction(decimalScale.n, 4);
  const wholeNoteRatio = new Fraction(durationRatio.n, quarterScale.d);
  const numerator = wholeNoteRatio.n * quarterScale.n;
  const denominator = wholeNoteRatio.d * durationRatio.d * decimalScale.d;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new Error("MusicXML position exceeds exact rational precision");
  }
  return new Fraction(numerator, denominator);
}
