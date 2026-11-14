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
                        id: "tuplet-event",
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
  it("applies event overrides", () => {
    const score = applyLayoutOverrides(makeScore(), "p0/m0/s0/ev1", {
      event: { staff: 2, stemDirection: "down" },
    });

    const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
    const event = sequence.content[0];
    expect(event?.type).toBe("event");
    if (event?.type === "event") {
      expect(event.staff).toBe(2);
      expect(event.stemDirection).toBe("down");
    }
  });

  it("applies and clears tuplet overrides", () => {
    const applied = applyLayoutOverrides(makeScore(), "p0/m0/s0/tuplet0", {
      tuplet: {
        placement: "above",
        bracket: "yes",
        showNumber: "both",
        showValue: "inner",
      },
    });

    const tuplet = applied.parts[0]!.measures[0]!.sequences[0]!.content[1];
    expect(tuplet?.type).toBe("tuplet");
    if (tuplet?.type === "tuplet") {
      expect(tuplet.placement).toBe("above");
      expect(tuplet.bracket).toBe("yes");
      expect(tuplet.showNumber).toBe("both");
      expect(tuplet.showValue).toBe("inner");
    }

    const cleared = applyLayoutOverrides(applied, "p0/m0/s0/tuplet0", {
      tuplet: {
        placement: null,
        bracket: null,
        showNumber: null,
        showValue: null,
      },
    });

    const clearedTuplet = cleared.parts[0]!.measures[0]!.sequences[0]!.content[1];
    expect(clearedTuplet?.type).toBe("tuplet");
    if (clearedTuplet?.type === "tuplet") {
      expect(clearedTuplet.placement).toBeUndefined();
      expect(clearedTuplet.bracket).toBeUndefined();
      expect(clearedTuplet.showNumber).toBeUndefined();
      expect(clearedTuplet.showValue).toBeUndefined();
    }
  });

  it("applies tuplet overrides when a contained event is targeted", () => {
    const updated = applyLayoutOverrides(makeScore(), "p0/m0/s0/tuplet-event", {
      tuplet: { placement: "below" },
    });
    const tuplet = updated.parts[0]!.measures[0]!.sequences[0]!.content[1];
    expect(tuplet?.type === "tuplet" && tuplet.placement).toBe("below");
  });

  it("does not mistake nested rendered tuplet ordinals for a different top-level tuplet", () => {
    const score = makeScore();
    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    const first = content[1]!;
    if (first.type !== "tuplet") throw new Error("Expected tuplet");
    first.content.push(structuredClone(first));
    content.push(structuredClone(first));
    const nested = applyLayoutOverrides(score, "p0/m0/s0/tuplet0", { tuplet: { placement: "above" } });
    expect(nested).toBe(score);
    const updated = applyLayoutOverrides(score, "p0/m0/s0/tuplet1", { tuplet: { placement: "below" } });
    const outer = updated.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    const other = updated.parts[0]!.measures[0]!.sequences[0]!.content[2]!;
    expect(outer.type === "tuplet" && outer.placement).toBe("below");
    expect(other.type === "tuplet" && other.placement).toBeUndefined();
  });
});
