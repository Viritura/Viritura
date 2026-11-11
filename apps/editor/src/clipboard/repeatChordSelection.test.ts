import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import type { SelectionState } from "../store/selectionStore";
import { buildClipboardSelection } from "./buildClipboardSelection";
import { computeRepeatResult } from "./computeRepeatResult";

function fixture(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          chordSymbols: [
            { position: { fraction: [0, 1] }, root: { step: "C" } },
            { position: { fraction: [1, 4] }, root: { step: "D" } },
            { position: { fraction: [1, 2] }, root: { step: "G" } },
            { position: { fraction: [3, 4] }, root: { step: "A" } },
          ],
        },
        { chordSymbols: [{ position: { fraction: [0, 1] }, root: { step: "F" } }] },
      ],
    },
    parts: [
      {
        chordSymbolVisibility: "show",
        measures: [0, 1].map((measure) => ({
          sequences: [
            {
              content: [0, 1, 2, 3].map((beat) => ({
                type: "event" as const,
                id: `note-${measure}-${beat}`,
                duration: { base: "quarter" as const },
                ...(beat === 3
                  ? { rest: {} }
                  : { notes: [{ id: `pitch-${measure}-${beat}`, pitch: { step: "C" as const, octave: 4 } }] }),
              })),
            },
          ],
        })),
      },
    ],
  };
}

const selections: { label: string; selection: SelectionState }[] = [
  {
    label: "a single rest across a barline",
    selection: { kind: "single", elementType: "rest", elementId: "p0/m0/s0/note-0-3" },
  },
  {
    label: "a single note",
    selection: { kind: "single", elementType: "event", elementId: "p0/m0/s0/note-0-0" },
  },
  {
    label: "a single notehead",
    selection: { kind: "single", elementType: "note", elementId: "p0/m0/s0/note-0-0/n0" },
  },
  {
    label: "a note range",
    selection: {
      kind: "range",
      startElementId: "p0/m0/s0/note-0-0",
      endElementId: "p0/m0/s0/note-0-1",
    },
  },
  {
    label: "multiple notes",
    selection: { kind: "multi", elementIds: ["p0/m0/s0/note-0-0", "p0/m0/s0/note-0-1"] },
  },
  {
    label: "a timed note selection",
    selection: {
      kind: "multi",
      elementIds: ["p0/m0/s0/note-0-0"],
      rhythmicRange: { start: { measureIndex: 0, beat: 0 }, end: { measureIndex: 0, beat: 1 } },
    },
  },
];

describe("repeat chord selection", () => {
  it.each(selections)("preserves harmony through successive repeats of $label", ({ selection }) => {
    let score = fixture();
    const harmony = structuredClone(score.global.measures.map((measure) => measure.chordSymbols));
    for (let repeat = 0; repeat < 2; repeat++) {
      const captured = buildClipboardSelection(score, selection)!;
      expect(captured).not.toBeNull();
      const snapshot = structuredClone({ score, captured });
      const result = computeRepeatResult(score, captured)!;
      expect(result).not.toBeNull();
      expect(result.newScore.global.measures.map((measure) => measure.chordSymbols)).toEqual(harmony);
      expect(result.selection).not.toBeNull();
      expect(result.newScore.parts[0]!.chordSymbolVisibility).toBe("show");
      expect({ score, captured }).toEqual(snapshot);
      score = result.newScore;
      selection = result.selection!;
    }
  });

  it("keeps incidental harmony available to normal copy and paste", () => {
    const captured = buildClipboardSelection(fixture(), {
      kind: "single",
      elementType: "event",
      elementId: "p0/m0/s0/note-0-0",
    })!;
    expect(captured.chordSymbols).toHaveLength(1);
    expect(captured.chordSymbols![0]!.chordSymbol.root).toEqual({ step: "C" });
  });

  it("repeats a chord-symbol range endpoint without incidental harmony", () => {
    const score = fixture();
    const captured = buildClipboardSelection(score, {
      kind: "range",
      startElementId: "m0/chord0/p0/staff1",
      endElementId: "p0/m0/s0/note-0-1",
    })!;
    expect(captured.chordSymbols).toHaveLength(2);
    const result = computeRepeatResult(score, captured)!;
    expect(result.newScore.global.measures[0]!.chordSymbols).toEqual([
      ...score.global.measures[0]!.chordSymbols!.slice(0, 2),
      { position: { fraction: [1, 2] }, root: { step: "C" } },
      score.global.measures[0]!.chordSymbols![3],
    ]);
  });

  it.each([false, true])("repeats only explicitly selected harmony in a mixed selection (timed: %s)", (timed) => {
    let score = fixture();
    let selection: SelectionState = {
      kind: "multi",
      elementIds: ["p0/m0/s0/note-0-1", "p0/m0/s0/note-0-2", "m0/chord1/p0/staff1"],
      ...(timed ? { rhythmicRange: { start: { measureIndex: 0, beat: 1 }, end: { measureIndex: 0, beat: 3 } } } : {}),
    };
    for (let repeat = 0; repeat < 2; repeat++) {
      const captured = buildClipboardSelection(score, selection)!;
      const result = computeRepeatResult(score, captured)!;
      expect(result).not.toBeNull();
      const measure = repeat === 0 ? 0 : 1;
      const fraction = repeat === 0 ? [3, 4] : [1, 4];
      expect(result.newScore.global.measures[measure]!.chordSymbols).toContainEqual({
        position: { fraction },
        root: { step: "D" },
      });
      expect(result.newScore.global.measures[0]!.chordSymbols![2]!.root).toEqual({ step: "G" });
      expect(result.newScore.global.measures[1]!.chordSymbols![0]!.root).toEqual({ step: "F" });
      score = result.newScore;
      selection = result.selection!;
    }
  });
});
