import { describe, expect, it } from "vitest";
import { applyPatchesToScore, type Score } from "@viritura/core";
import { applyBreathFermata } from "../radialMenu/radialMenuActions";
import { globalCaesuraMeasure, planCaesuraProperties, selectedCaesura } from "../commands/caesura";
import { removeCaesura } from "../commands/markingSelection";

function score(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "piano",
        staves: 2,
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "note",
                    duration: { base: "whole" },
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

describe("global caesura authoring", () => {
  it("attaches a barline hold to the preceding global measure, not an event", () => {
    const edited = applyBreathFermata(score(), { kind: "single", elementId: "m1/barline" }, { kind: "caesura" })!;
    expect(edited.global.measures[0]!.caesura).toEqual({});
    expect(edited.parts[0]!.measures[0]!.sequences[0]!.content[0]).not.toHaveProperty("markings");
    expect(applyBreathFermata(score(), { kind: "single", elementId: "m0/barline" }, { kind: "caesura" })).toBeNull();
  });

  it("keeps note selection event-local", () => {
    const edited = applyBreathFermata(score(), { kind: "single", elementId: "p0/m0/s0/note" }, { kind: "caesura" })!;
    expect(edited.global.measures[0]!.caesura).toBeUndefined();
    expect(selectedCaesura(edited, "p0/m0/s0/note/caesura")).toEqual({});
    const eventEdited = applyPatchesToScore(
      edited,
      planCaesuraProperties(edited, "p0/m0/s0/note/caesura", { marks: 1 })!,
    );
    expect(selectedCaesura(eventEdited, "p0/m0/s0/note/caesura")).toEqual({ marks: 1 });
  });

  it("edits and removes the single shared identity while retaining marker metadata", () => {
    const original = score();
    original.global.measures[0]!.caesura = { id: "pause", _c: "keep", _x: { test: 7 } };
    const id = "m0/caesura";
    expect(globalCaesuraMeasure(id)).toBe(0);
    const edited = applyPatchesToScore(original, planCaesuraProperties(original, id, { style: "thick", marks: 1 })!);
    expect(edited.global.measures[0]!.caesura).toEqual({
      id: "pause",
      _c: "keep",
      _x: { test: 7 },
      style: "thick",
      marks: 1,
    });
    expect(original.global.measures[0]!.caesura).not.toHaveProperty("style");
    const removed = applyPatchesToScore(edited, planCaesuraProperties(edited, id, undefined)!);
    expect(removed.global.measures[0]!.caesura).toBeUndefined();
    expect(removeCaesura(structuredClone(edited), id)!.global.measures[0]!.caesura).toBeUndefined();
  });
});
