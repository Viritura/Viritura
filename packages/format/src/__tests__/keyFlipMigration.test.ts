import { describe, expect, it } from "vitest";
import { parseMnx } from "../mnx/parser";

function document(partTransposition: Record<string, unknown>, hasVirituraExtension: boolean) {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          ...(hasVirituraExtension ? { _x: { viritura: { systemText: [] } } } : {}),
        },
      ],
    },
    parts: [
      {
        name: "Clarinet",
        transposition: partTransposition,
        measures: [{ sequences: [{ content: [] }] }],
      },
    ],
  };
}

describe("legacy transposing-key flip migration", () => {
  it("applies the legacy boundary only to Viritura documents and missing values", () => {
    const interval = { interval: { halfSteps: 2, staffDistance: 1 } };
    expect(parseMnx(document(interval, true)).parts[0]?.transposition?.keyFifthsFlipAt).toBe(7);
    expect(parseMnx(document(interval, false)).parts[0]?.transposition?.keyFifthsFlipAt).toBeUndefined();
    expect(parseMnx(document({ ...interval, keyFifthsFlipAt: 5 }, true)).parts[0]?.transposition?.keyFifthsFlipAt).toBe(
      5,
    );
  });

  it("does not apply the flip boundary to non-transposing parts", () => {
    const score = parseMnx(document({ interval: { halfSteps: 0, staffDistance: 0 } }, true));
    expect(score.parts[0]?.transposition?.keyFifthsFlipAt).toBeUndefined();
  });
});
