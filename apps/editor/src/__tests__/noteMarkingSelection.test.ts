import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { applyPatchesToScore, patch, type NoteEvent, type Score, type ScorePatch } from "@viritura/core";
import { applyNoteMarkingToSelection } from "../radialMenu/noteMarkingSelection";
import { useNoteMarkingHandler } from "../components/inspector/useNoteMarkingHandler";
import { useViewStateStore } from "../store/viewStateStore";

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
  it.each([false, true])(
    "inspector writes merged sources but respects expansion selections (expanded=%s)",
    (expanded) => {
      const score = chordScore();
      const second = structuredClone(score.parts[0]!);
      second.id = "p1";
      const event = second.measures[0]!.sequences[0]!.content[0]!;
      if (event.type !== "event") throw new Error("Expected event");
      event.id = "ev1";
      for (const [index, note] of event.notes!.entries()) note.id = `second-${index}`;
      score.parts.push(second);
      score.layouts = [{ id: "condensed", content: [{ type: "staff", sources: [{ part: "p0" }, { part: "p1" }] }] }];
      score.scores = [{ name: "Condensed", layout: "condensed" }];
      useViewStateStore.setState({ selectedScoreIndex: 0 });
      const commitPatches = vi.fn<(patches: readonly ScorePatch[]) => void>();
      const { result } = renderHook(() =>
        useNoteMarkingHandler({
          score,
          selection: {
            kind: "single",
            elementId: "p0/m0/s0/ev0/n1",
            elementType: "note",
            ...(expanded ? { measureAnchor: { partIndex: 0, staffIndex: 1, measureIndex: 0, isExpansion: true } } : {}),
          },
          commitPatches,
        }),
      );
      act(() => result.current.setSlideIn("scoop"));
      const patches = commitPatches.mock.calls[0]![0];
      expect(patches).toHaveLength(expanded ? 1 : 2);
      const updated = applyPatchesToScore(score, patches);
      expect(chord(updated).notes![1]!.markings).toEqual({ slideIn: { type: "scoop" }, slideOut: { type: "falloff" } });
      const other = updated.parts[1]!.measures[0]!.sequences[0]!.content[0]!;
      if (other.type !== "event") throw new Error("Expected event");
      expect(other.notes![1]!.markings?.slideIn).toEqual(expanded ? undefined : { type: "scoop" });
    },
  );

  it("does not collapse matching note indices in separate tuplets", () => {
    const score = chordScore();
    const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
    sequence.content = [0, 1].map((index) => ({
      type: "tuplet",
      outer: { multiple: 2, duration: { base: "eighth" } },
      inner: { multiple: 3, duration: { base: "eighth" } },
      content: [
        {
          type: "event",
          id: `tuplet-event-${index}`,
          duration: { base: "eighth" },
          notes: [{ id: `tuplet-note-${index}`, pitch: { step: "C", octave: 4 } }],
        },
      ],
    }));
    const result = applyNoteMarkingToSelection(
      score,
      { kind: "multi", elementIds: ["p0/m0/s0/tuplet-event-0/n0", "p0/m0/s0/tuplet-event-1/n0"] },
      { key: "slideOut", type: "doit" },
    )!;
    for (const container of result.parts[0]!.measures[0]!.sequences[0]!.content) {
      expect(container.type).toBe("tuplet");
      if (container.type !== "tuplet") continue;
      const event = container.content[0]!;
      expect(event.type === "event" && event.notes?.[0]?.markings?.slideOut).toEqual({ type: "doit" });
    }
  });

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
