import { describe, expect, it } from "vitest";
import { parseTimeSignatureInput, TIME_SIGNATURE_UNITS } from "../components/palette";

describe("parseTimeSignatureInput", () => {
  it.each(TIME_SIGNATURE_UNITS)("accepts denominator %i", (unit) => {
    expect(parseTimeSignatureInput(`5/${unit}`)).toEqual({ count: 5, unit });
  });

  it("accepts surrounding whitespace", () => {
    expect(parseTimeSignatureInput(" 12 / 16 ")).toEqual({ count: 12, unit: 16 });
  });

  it.each(["", "0/4", "1000/4", "5/3", "5/256", "3+2/8", "five/eight"])("rejects %s", (input) => {
    expect(parseTimeSignatureInput(input)).toBeNull();
  });
});
