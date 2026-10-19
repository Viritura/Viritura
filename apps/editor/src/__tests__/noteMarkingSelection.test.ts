import { describe, expect, it } from "vitest";
import { applyPatchesToScore, patch, type NoteEvent, type Score } from "@viritura/core";
import { applyNoteMarkingToSelection } from "../radialMenu/noteMarkingSelection";

function chordScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0" }] },
    parts: [
      {
        id: "p0",
        name: "Trumpet",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "ev0",
                    duration: { base: "quarter" },
                    markings: { staccato: {} },
                    notes: [
                      { id: "n0", pitch: { step: "C", octave: 4 } },
                      { id: "n1", pitch: { step: "E", octave: 4 }, markings: { slideOut: { type: "falloff" } } },
                      { id: "n2", pitch: { step: "G", octave: 4 } },
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

function chord(score: Score): NoteEvent {
  return score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
}

describe("note-scoped slide markings", () => {
  it("changes only the selected chord member and leaves event articulations alone", () => {
    const score = chordScore();
    const selected = { kind: "single", elementId: "p0/m0/s0/ev0/n1", elementType: "note" } as const;
    const result = applyNoteMarkingToSelection(score, selected, { key: "slideIn", type: "plop" });

    expect(chord(score).notes?.map((note) => note.markings)).toEqual([
      undefined,
      { slideOut: { type: "falloff" } },
      undefined,
    ]);
    expect(chord(result!).notes?.map((note) => note.markings)).toEqual([
      undefined,
      { slideIn: { type: "plop" }, slideOut: { type: "falloff" } },
      undefined,
    ]);
    expect(chord(result!).markings?.staccato).toEqual({});
  });

  it("supports typed per-note patches and independent removal for delta/undo paths", () => {
    const score = chordScore();
    const locator = {
      sequencePath: { partId: "p0", measureIndex: 0, voice: 0 },
      eventId: "ev0",
    };
    const withScoop = applyPatchesToScore(score, [patch.setNoteMarking(locator, "n1", "slideIn", { type: "scoop" })]);
    expect(chord(withScoop).notes?.[1]?.markings).toEqual({
      slideIn: { type: "scoop" },
      slideOut: { type: "falloff" },
    });
    const withoutScoop = applyPatchesToScore(withScoop, [patch.setNoteMarking(locator, "n1", "slideIn", undefined)]);
    expect(chord(withoutScoop).notes?.[1]?.markings).toEqual({ slideOut: { type: "falloff" } });
    expect(chord(score).notes?.[1]?.markings?.slideIn).toBeUndefined();
  });
});
