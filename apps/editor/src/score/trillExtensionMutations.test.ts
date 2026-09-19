import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { reanchorTrillExtension, removeTrillExtensionByElementId } from "./trillExtensionMutations";

function scoreWithTrill(showSymbol = true): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
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
                    markings: { trill: { showSymbol, extension: { target: "ev2" } } },
                  },
                  {
                    type: "event",
                    id: "ev2",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "D", octave: 4 } }],
                  },
                  {
                    type: "event",
                    id: "ev3",
                    duration: { base: "half" },
                    notes: [{ pitch: { step: "E", octave: 4 } }],
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

describe("trill extension mutations", () => {
  it("reanchors the extension without mutating the input score", () => {
    const score = scoreWithTrill();
    const next = reanchorTrillExtension(score, "trill-line/ev1/ev2", "ev3", "end");
    const source = next.parts[0]!.measures[0]!.sequences[0]!.content[0]!;

    expect(source.type === "event" ? source.markings?.trill?.extension?.target : undefined).toBe("ev3");
    expect(source.type === "event" ? source.markings?.trill?.extension?.targetEdge : undefined).toBe("end");
    const original = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(original.type === "event" ? original.markings?.trill?.extension?.target : undefined).toBe("ev2");
  });

  it("rejects a backwards trill extension", () => {
    const score = scoreWithTrill();
    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    if (event.type !== "event") throw new Error("expected note event");
    event.markings = { trill: { extension: { target: "ev3" } } };

    expect(reanchorTrillExtension(score, "trill-line/ev2/ev3", "ev1", "end")).toBe(score);
  });

  it("allows a trill extension to end at its source note's release", () => {
    const score = scoreWithTrill();
    const next = reanchorTrillExtension(score, "trill-line/ev1/ev2", "ev1", "end");
    const source = next.parts[0]!.measures[0]!.sequences[0]!.content[0]!;

    expect(source.type === "event" ? source.markings?.trill?.extension : undefined).toEqual({
      target: "ev1",
      targetEdge: "end",
    });
  });

  it("removes only the extension when the trill symbol remains visible", () => {
    const score = scoreWithTrill();
    const next = removeTrillExtensionByElementId(score, "trill-line/ev1/ev2")!;
    const source = next.parts[0]!.measures[0]!.sequences[0]!.content[0]!;

    expect(source.type === "event" ? source.markings?.trill : undefined).toEqual({ showSymbol: true });
  });

  it("removes an extension-only trill entirely", () => {
    const score = scoreWithTrill(false);
    const next = removeTrillExtensionByElementId(score, "trill-line/ev1/ev2")!;
    const source = next.parts[0]!.measures[0]!.sequences[0]!.content[0]!;

    expect(source.type === "event" ? source.markings?.trill : undefined).toBeUndefined();
  });
});
