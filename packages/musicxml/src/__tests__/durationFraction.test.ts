import { describe, expect, it } from "vitest";
import { durationFraction } from "../convert/durationFraction";

describe("MusicXML duration fractions", () => {
  it.each([
    [1, 2.4, [5, 48]],
    [0.3, 2.4, [1, 32]],
    [-0.1, 2.4, [-1, 96]],
    [0, 2.4, [0, 1]],
    [1.00000001, 1.00000001, [1, 4]],
    [0.0000001, 0.0000001, [1, 4]],
    [0.0000001, 2.4, [1, 96000000]],
    [4, 3000000000000000, [1, 3000000000000000]],
  ])("converts duration %s at divisions %s exactly", (duration, divisions, expected) => {
    expect(durationFraction(duration, divisions).toMnxFraction()).toEqual(expected);
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid divisions %s", (divisions) => {
    expect(() => durationFraction(1, divisions)).toThrow("Invalid MusicXML divisions");
  });

  it.each([
    [NaN, 1],
    [Infinity, 1],
    [Number.MAX_SAFE_INTEGER + 1, 1],
    [1e-16, 1],
    [1, Number.MAX_SAFE_INTEGER],
  ])("rejects duration %s at divisions %s outside exact precision", (duration, divisions) => {
    expect(() => durationFraction(duration, divisions)).toThrow("exact rational precision");
  });
});
