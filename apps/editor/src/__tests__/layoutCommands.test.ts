import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { applyLayoutOverrides } from "../commands/layoutCommands";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{}] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "ev1",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                  {
                    type: "tuplet",
                    inner: { duration: { base: "eighth" }, multiple: 3 },
                    outer: { duration: { base: "eighth" }, multiple: 2 },
                    content: [
                      {
                        type: "event",
                        duration: { base: "eighth" },
                        rest: {},
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("layoutCommands", () => {
  it("applies event and sequence overrides", () => {
    const score = applyLayoutOverrides(makeScore(), "p0/m0/s0/ev1", {
      event: { staff: 2, stemDirection: "down", orient: "below" },
      sequence: { orient: "above" },
    });

    const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
    const event = sequence.content[0];
    expect(sequence.orient).toBe("above");
    expect(event?.type).toBe("event");
    if (event?.type === "event") {
      expect(event.staff).toBe(2);
      expect(event.stemDirection).toBe("down");
      expect(event.orient).toBe("below");
    }
  });

  it("applies and clears tuplet overrides", () => {
    const applied = applyLayoutOverrides(makeScore(), "p0/m0/s0/e1", {
      tuplet: {
        orient: "above",
        bracket: "yes",
        showNumber: "both",
        showValue: "inner",
      },
    });

    const tuplet = applied.parts[0]!.measures[0]!.sequences[0]!.content[1];
    expect(tuplet?.type).toBe("tuplet");
    if (tuplet?.type === "tuplet") {
      expect(tuplet.orient).toBe("above");
      expect(tuplet.bracket).toBe("yes");
      expect(tuplet.showNumber).toBe("both");
      expect(tuplet.showValue).toBe("inner");
    }

    const cleared = applyLayoutOverrides(applied, "p0/m0/s0/e1", {
      tuplet: {
        orient: null,
        bracket: null,
        showNumber: null,
        showValue: null,
      },
    });

    const clearedTuplet = cleared.parts[0]!.measures[0]!.sequences[0]!.content[1];
    expect(clearedTuplet?.type).toBe("tuplet");
    if (clearedTuplet?.type === "tuplet") {
      expect(clearedTuplet.orient).toBeUndefined();
      expect(clearedTuplet.bracket).toBeUndefined();
      expect(clearedTuplet.showNumber).toBeUndefined();
      expect(clearedTuplet.showValue).toBeUndefined();
    }
  });
});
