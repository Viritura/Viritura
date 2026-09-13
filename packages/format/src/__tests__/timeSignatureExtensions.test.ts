import { describe, expect, it } from "vitest";
import { parseMnx } from "../mnx/parser";
import { serializeMnx } from "../mnx/serializer";
import { validateRawScore } from "../mnx/validator";

function scoreWithBeatStructure(beatStructure: unknown) {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: {
            count: 9,
            unit: 8,
            _x: { viritura: { beatStructure } },
          },
        },
      ],
    },
    parts: [{ measures: [{ sequences: [{ content: [] }] }] }],
  };
}

describe("time-signature beatStructure extension", () => {
  it("round-trips an authored beat structure", () => {
    const source = scoreWithBeatStructure([2, 3, 2, 2]);
    const parsed = parseMnx(source);

    expect(parsed.global.measures[0]!.time?.beatStructure).toEqual([2, 3, 2, 2]);
    expect(serializeMnx(parsed)).toMatchObject(source);
  });

  it("rejects groups that do not sum to the numerator", () => {
    const result = validateRawScore(scoreWithBeatStructure([2, 3, 2]));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          pointer: "/global/measures/0/time/_x/viritura/beatStructure",
          keyword: "sum",
        }),
      );
    }
  });

  it("rejects empty and non-positive groups", () => {
    expect(validateRawScore(scoreWithBeatStructure([])).ok).toBe(false);
    expect(validateRawScore(scoreWithBeatStructure([2, 0, 7])).ok).toBe(false);
  });
});
