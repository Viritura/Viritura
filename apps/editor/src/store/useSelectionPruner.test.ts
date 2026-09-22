import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { isSelectionIdValid } from "./useSelectionPruner";
import { buildNavigationIndex } from "../navigation";

function score(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, tempos: [{ bpm: 120, value: { base: "quarter" } }] }],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            clefs: [{ clef: { sign: "G", line: 2 }, position: { fraction: [0, 1] } }],
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "ev1",
                    duration: { base: "quarter" },
                    notes: [{ id: "n1", pitch: { step: "C", octave: 4 } }],
                    markings: { staccato: {}, fingerings: [{ finger: 1 }] },
                    lyrics: { lines: { verse: { text: "La" } } },
                  },
                ],
              },
            ],
            expressions: [{ text: "dolce", position: { fraction: [0, 1] } }],
          },
        ],
      },
    ],
  };
}

describe("isSelectionIdValid", () => {
  it("keeps global chord roots and copies while their canonical chord exists", () => {
    const current = score();
    current.global.measures[0]!.chordSymbols = [
      { position: { fraction: [0, 1] }, root: { step: "C" }, quality: "major" },
    ];
    for (const id of ["m0/chord0", "m0/chord0/p0/staff1", "m0/chord0/p9/staff2"]) {
      expect(isSelectionIdValid(id, current)).toBe(true);
    }
    for (const id of [
      "p0/m0/chord0",
      "m0/chord1",
      "m9/chord0/p0/staff1",
      "m0/chord0/p0/staff1/extra",
      "m0/chord0junk",
      "m0/chord",
    ]) {
      expect(isSelectionIdValid(id, current)).toBe(false);
    }
    delete current.global.measures[0]!.chordSymbols;
    expect(isSelectionIdValid("m0/chord0", current)).toBe(false);
    expect(isSelectionIdValid("m0/chord0/p0/staff1", current)).toBe(false);
  });

  it("keeps a navigable full-measure rest but rejects nonexistent sub-elements", () => {
    const current = score();
    const sequence = current.parts[0]!.measures[0]!.sequences[0]!;
    sequence.content = [];
    sequence.fullMeasure = { visualDuration: { base: "whole" } };
    const id = buildNavigationIndex(current).entries.find((entry) => entry.isRest)!.elementId;
    expect(isSelectionIdValid(id, current)).toBe(true);
    expect(isSelectionIdValid(`${id}/n0`, current)).toBe(false);
    delete sequence.fullMeasure;
    expect(isSelectionIdValid(id, current)).toBe(false);
  });

  it("validates the concrete event sub-element", () => {
    const current = score();
    expect(isSelectionIdValid("p0/m0/s0/ev1/art-staccato", current)).toBe(true);
    const event = current.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (event.type !== "event") throw new Error("Expected note event fixture");
    event.markings = {};
    expect(isSelectionIdValid("p0/m0/s0/ev1/art-staccato", current)).toBe(false);
  });

  it("validates annotation indices instead of only the containing measure", () => {
    const current = score();
    expect(isSelectionIdValid("p0/m0/expr0", current)).toBe(true);
    delete current.parts[0]!.measures[0]!.expressions;
    expect(isSelectionIdValid("p0/m0/expr0", current)).toBe(false);
  });

  it("rejects unknown structured and bare IDs", () => {
    expect(isSelectionIdValid("p0/m0/not-real", score())).toBe(false);
    expect(isSelectionIdValid("not-real", score())).toBe(false);
  });

  it("keeps valid structural score elements", () => {
    const current = score();
    expect(isSelectionIdValid("p0/m0/clef", current)).toBe(true);
    expect(isSelectionIdValid("m0/time", current)).toBe(true);
    expect(isSelectionIdValid("m0/barline", current)).toBe(true);
    expect(isSelectionIdValid("m0/mnum", current)).toBe(true);
  });

  it("validates tuplets by tuplet ordinal rather than raw content index", () => {
    const current = score();
    current.parts[0]!.measures[0]!.sequences[0]!.content.push({
      type: "tuplet",
      inner: { duration: { base: "eighth" }, multiple: 3 },
      outer: { duration: { base: "quarter" }, multiple: 1 },
      content: [],
    });
    expect(isSelectionIdValid("p0/m0/s0/tuplet0", current)).toBe(true);
  });

  it("normalizes cross-system spanner segment IDs", () => {
    const current = score();
    const content = current.parts[0]!.measures[0]!.sequences[0]!.content;
    const source = content[0]!;
    if (source.type !== "event") throw new Error("Expected note event fixture");
    source.slurs = [{ target: "ev2" }];
    content.push({
      type: "event",
      id: "ev2",
      duration: { base: "quarter" },
      notes: [{ id: "n2", pitch: { step: "D", octave: 4 } }],
    });

    expect(isSelectionIdValid("slur/ev1/ev2/lh", current)).toBe(true);
    expect(isSelectionIdValid("slur/ev1/ev2/mid/1", current)).toBe(true);
  });
});
