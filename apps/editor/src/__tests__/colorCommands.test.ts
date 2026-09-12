import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { applyColorToSelection, normalizeHexColor, resolveColorSelectionTarget } from "../commands/colorCommands";
import type { NotationSelectionTarget } from "../commands/notationInspectorCommands";

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

describe("selection-aware color commands", () => {
  it("resolves color support from the selected object", () => {
    const score = makeScore();
    expect(resolveColorSelectionTarget(score, target("p0/m0/key", "key"))).toEqual({
      kind: "key",
      label: "key signature",
      color: undefined,
    });
    expect(resolveColorSelectionTarget(score, target("p0/m0/s0/n1", "event", 1))).toBeNull();
  });

  it("applies color directly to the selected key signature", () => {
    const score = makeScore();
    const selected = target("p0/m0/key", "key");
    const next = applyColorToSelection(score, selected, "#00aa00");
    expect(next.global.measures[0]!.key).toEqual({ fifths: 2, color: "#00aa00" });
  });

  it("keeps explicit black and removes color only when reset", () => {
    const score = makeScore();
    const selected = target("m0/volta", "volta");
    const black = applyColorToSelection(score, selected, "#000000");
    expect(black.global.measures[0]!.ending?.color).toBe("#000000");
    const cleared = applyColorToSelection(black, selected, null);
    expect(cleared.global.measures[0]!.ending).toEqual({ duration: 1, numbers: [1] });
  });

  it("applies clef color on selected part measure", () => {
    const score = makeScore();
    const selected = target("p0/m0/clef", "clef");
    const next = applyColorToSelection(score, selected, "#ff0000");
    expect(next.parts[0]!.measures[0]!.clefs?.[0]!.clef.color).toBe("#ff0000");
  });

  it("applies grace color only when the grace group itself is selected", () => {
    const score = makeScore();
    const selected = target("p0/m0/s0/g1", "event", 0);
    const next = applyColorToSelection(score, selected, "#3366ff");
    const event = next.parts[0]!.measures[0]!.sequences[0]!.content[0];
    expect(event?.type).toBe("grace");
    if (event?.type === "grace") {
      expect(event.color).toBe("#3366ff");
    }
  });
});

function target(elementId: string, elementType: string, eventIndex?: number): NotationSelectionTarget {
  return {
    elementId,
    elementType,
    partIndex: 0,
    measureIndex: 0,
    sequenceIndex: eventIndex === undefined ? undefined : 0,
    eventIndex,
  };
}
