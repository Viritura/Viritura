import { describe, expect, it } from "vitest";
import { parseTimeSignatureInput, parseTimeSignatureInputWithError, TIME_SIGNATURE_UNITS } from "../components/palette";

describe("parseTimeSignatureInput", () => {
  it.each(TIME_SIGNATURE_UNITS)("accepts denominator %i", (unit) => {
    expect(parseTimeSignatureInput(`5/${unit}`)).toEqual({ count: 5, unit });
  });

  it("accepts surrounding whitespace", () => {
    expect(parseTimeSignatureInput(" 12 / 16 ")).toEqual({ count: 12, unit: 16 });
  });

  it.each([
    ["5/8 23", [2, 3]],
    ["7/8 3+2+2", [3, 2, 2]],
    ["9/8 2,3,2,2", [2, 3, 2, 2]],
    ["13/8 10+3", [10, 3]],
  ])("accepts explicit grouping in %s", (input, beatStructure) => {
    expect(parseTimeSignatureInput(input)).toEqual({
      count: beatStructure.reduce((sum, group) => sum + group),
      unit: 8,
      beatStructure,
    });
  });

  it("normalizes an explicitly entered conventional grouping to automatic", () => {
    expect(parseTimeSignatureInput("5/8 32")).toEqual({ count: 5, unit: 8 });
  });

  it("returns a precise grouping validation error", () => {
    expect(parseTimeSignatureInputWithError("5/8 22")).toEqual({
      time: null,
      error: "Beat groups total 4, but the meter numerator is 5",
    });
    expect(parseTimeSignatureInputWithError("7/8 2+2,3")).toEqual({
      time: null,
      error: "Use either + or , between beat groups, not both",
    });
  });

  it.each(["", "0/4", "1000/4", "5/3", "5/256", "3+2/8", "five/eight", "7/8 2032"])("rejects %s", (input) => {
    expect(parseTimeSignatureInput(input)).toBeNull();
  });
});
