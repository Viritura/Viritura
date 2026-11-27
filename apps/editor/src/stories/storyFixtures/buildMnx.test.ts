import { describe, expect, it } from "vitest";
import { buildMnx } from "./buildMnx";

describe("buildMnx", () => {
  it("assigns voice home staves without forcing event stems", () => {
    const score = JSON.parse(
      buildMnx({
        staves: 2,
        measures: [
          {
            voices: [
              [{ notes: [{ step: "C", octave: 5 }] }],
              { staff: 2, events: [{ notes: [{ step: "A", octave: 2 }] }] },
            ],
          },
        ],
      }),
    ) as { parts: Array<{ measures: Array<{ sequences: Array<{ staff?: number; content: object[] }> }> }> };
    expect(score.parts[0]!.measures[0]!.sequences).toEqual([
      {
        content: [{ duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 5 } }] }],
      },
      {
        staff: 2,
        content: [{ duration: { base: "quarter" }, notes: [{ pitch: { step: "A", octave: 2 } }] }],
      },
    ]);
  });
});
