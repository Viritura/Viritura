import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { applyColorToTarget, normalizeHexColor, parseSelectionContext } from "../commands/colorCommands";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          key: { fifths: 2 },
          ending: { duration: 1, numbers: [1] },
          segno: { location: { fraction: [0, 1] } },
          fine: { location: { fraction: [1, 2] } },
          coda: { location: { fraction: [3, 4] } },
        },
      ],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
            sequences: [
              {
                content: [
                  {
                    type: "grace",
                    id: "g1",
                    content: [
                      {
                        type: "event",
                        id: "e1",
                        duration: { base: "eighth" },
                        notes: [{ pitch: { step: "D", octave: 5 } }],
                      },
                    ],
                  },
                  {
                    type: "event",
                    id: "n1",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
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

describe("normalizeHexColor", () => {
  it("accepts and normalizes 6-digit hex values", () => {
    expect(normalizeHexColor("#A1B2C3")).toBe("#a1b2c3");
  });

  it("expands 3-digit hex values", () => {
    expect(normalizeHexColor("#f0A")).toBe("#ff00aa");
  });

  it("rejects invalid color values", () => {
    expect(normalizeHexColor("blue")).toBeNull();
    expect(normalizeHexColor("#12")).toBeNull();
  });
});

describe("parseSelectionContext", () => {
  it("parses part+measure context from event IDs", () => {
    const score = makeScore();
    expect(parseSelectionContext("p0/m0/s0/g1", score)).toEqual({
      measureIndex: 0,
      partIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    });
  });

  it("parses measure-only IDs like time signatures", () => {
    const score = makeScore();
    expect(parseSelectionContext("m0/time", score)).toEqual({
      measureIndex: 0,
      partIndex: 0,
    });
  });
});

describe("applyColorToTarget", () => {
  it("applies key color and keeps other fields", () => {
    const score = makeScore();
    const next = applyColorToTarget(score, "key", "#00aa00", { measureIndex: 0, partIndex: 0 });
    expect(next.global.measures[0]!.key).toEqual({ fifths: 2, color: "#00aa00" });
  });

  it("removes color property when color is black", () => {
    const score = makeScore();
    const colored = applyColorToTarget(score, "ending", "#123456", { measureIndex: 0, partIndex: 0 });
    const cleared = applyColorToTarget(colored, "ending", "#000000", { measureIndex: 0, partIndex: 0 });
    expect(cleared.global.measures[0]!.ending).toEqual({ duration: 1, numbers: [1] });
  });

  it("applies clef color on selected part measure", () => {
    const score = makeScore();
    const next = applyColorToTarget(score, "clef", "#ff0000", { measureIndex: 0, partIndex: 0 });
    expect(next.parts[0]!.measures[0]!.clefs?.[0]!.clef.color).toBe("#ff0000");
  });

  it("applies grace color to selected grace event", () => {
    const score = makeScore();
    const next = applyColorToTarget(score, "grace", "#3366ff", {
      measureIndex: 0,
      partIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    });
    const event = next.parts[0]!.measures[0]!.sequences[0]!.content[0];
    expect(event?.type).toBe("grace");
    if (event?.type === "grace") {
      expect(event.color).toBe("#3366ff");
    }
  });
});
