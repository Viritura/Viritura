import { describe, it, expect } from "vitest";
import type { Markings, NoteEvent, Score } from "@viritura/core";
import type { Selection } from "../store/selectionStore";
import type { KeyboardHandlerContext } from "../keyboard/types";
import { handleDelete } from "../keyboard/normalModeDelete";
import { isArticulationId, removeArticulation } from "../commands/articulationDeletion";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";
import { articulationNamesInMarkings, markingsForArticulationName } from "../score/articulationNames";

function makeScore(markings: Markings): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Violin",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "e1",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                    markings,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Score;
}

function eventOf(score: Score): NoteEvent {
  return score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
}

const ACCENT = "p0/m0/s0/e1/art-accent";

describe("isArticulationId", () => {
  it("recognises named articulation ids and nothing else", () => {
    expect(isArticulationId(ACCENT)).toBe(true);
    expect(isArticulationId("p0/m0/s0/e1/art-accent.staccato")).toBe(true);
    expect(isArticulationId("p0/m0/s0/e1/art-bowDirection")).toBe(true);
    expect(isArticulationId("p0/m0/s0/e1/acc0")).toBe(false);
    expect(isArticulationId("p0/m0/s0/e1/n0")).toBe(false);
    expect(isArticulationId("p0/m0/s0/e1")).toBe(false);
  });
});

describe("markingsForArticulationName", () => {
  it("maps a single name to its marking", () => {
    expect(markingsForArticulationName("accent")).toEqual(["accent"]);
    expect(markingsForArticulationName("strongAccent")).toEqual(["strongAccent"]);
  });

  it("maps a combo name to both constituents", () => {
    expect(markingsForArticulationName("accent.staccato")).toEqual(["accent", "staccato"]);
    expect(markingsForArticulationName("strongAccent.tenuto")).toEqual(["strongAccent", "tenuto"]);
  });

  it("rejects names it doesn't recognise", () => {
    expect(markingsForArticulationName("trill")).toEqual([]);
    expect(markingsForArticulationName("accent.nonsense")).toEqual([]);
  });
});

describe("articulationNamesInMarkings", () => {
  it("collapses a combo pair into one ligature name", () => {
    expect(articulationNamesInMarkings({ accent: {}, staccato: {} })).toEqual(["accent.staccato"]);
    expect(articulationNamesInMarkings({ strongAccent: {}, tenuto: {} })).toEqual(["strongAccent.tenuto"]);
  });

  it("keeps three-way stacks separate — only pairs form ligatures", () => {
    expect(articulationNamesInMarkings({ accent: {}, staccato: {}, tenuto: {} })).toEqual([
      "staccato",
      "tenuto",
      "accent",
    ]);
  });

  it("never combines the markings that have no ligature", () => {
    expect(articulationNamesInMarkings({ staccatissimo: {}, spiccato: {} })).toEqual(["staccatissimo", "spiccato"]);
  });

  it("suppresses softAccent when it is drawn as the tenuto-accent ligature", () => {
    // The two share a codepoint; the ligature wins.
    expect(articulationNamesInMarkings({ tenuto: {}, accent: {}, softAccent: {} })).toEqual(["tenuto.accent"]);
  });

  it("returns nothing for an event with no markings", () => {
    expect(articulationNamesInMarkings(undefined)).toEqual([]);
    expect(articulationNamesInMarkings({})).toEqual([]);
  });
});

describe("removeArticulation", () => {
  it("removes just the named marking", () => {
    const score = makeScore({ accent: {}, staccatissimo: {} });
    expect(removeArticulation(score, ACCENT)).not.toBeNull();

    expect(eventOf(score).markings?.accent).toBeUndefined();
    expect(eventOf(score).markings?.staccatissimo).toBeDefined();
  });

  it("removes both constituents of a ligature", () => {
    const score = makeScore({ accent: {}, staccato: {} });
    expect(removeArticulation(score, "p0/m0/s0/e1/art-accent.staccato")).not.toBeNull();

    expect(eventOf(score).markings).toBeUndefined();
  });

  it("drops the markings bag once it is empty", () => {
    const score = makeScore({ accent: {} });
    removeArticulation(score, ACCENT);
    expect("markings" in eventOf(score)).toBe(false);
  });

  it("keeps the markings bag when other markings remain", () => {
    const score = makeScore({ accent: {}, trill: {} });
    removeArticulation(score, ACCENT);
    expect(eventOf(score).markings?.trill).toBeDefined();
  });

  it("never touches the notes", () => {
    const score = makeScore({ accent: {} });
    removeArticulation(score, ACCENT);
    expect(eventOf(score).notes).toHaveLength(1);
    expect(eventOf(score).rest).toBeUndefined();
  });

  it("declines when the event lacks that marking", () => {
    expect(removeArticulation(makeScore({ tenuto: {} }), ACCENT)).toBeNull();
  });

  it("declines on ids that are not articulations", () => {
    expect(removeArticulation(makeScore({ accent: {} }), "p0/m0/s0/e1/n0")).toBeNull();
  });
});

describe("computeDeleteSelection — articulations", () => {
  it("strips the marking instead of replacing the event with a rest", () => {
    const result = computeDeleteSelection(makeScore({ accent: {} }), {
      kind: "single",
      elementId: ACCENT,
    } as never);

    expect(result.kind).toBe("single");
    const ev = eventOf((result as { score: Score }).score);
    expect(ev.rest).toBeUndefined();
    expect(ev.notes).toHaveLength(1);
  });

  it("clears the selection, since the articulation it pointed at is gone", () => {
    const result = computeDeleteSelection(makeScore({ accent: {} }), {
      kind: "single",
      elementId: ACCENT,
    } as never);
    expect((result as { nextSelection: { kind: string } }).nextSelection.kind).toBe("clear");
  });

  it("is a no-op when the marking isn't there", () => {
    expect(computeDeleteSelection(makeScore({ tenuto: {} }), { kind: "single", elementId: ACCENT } as never).kind).toBe(
      "noop",
    );
  });
});

// ═══════════════════════════════════════════
// The keyboard Delete path
// ═══════════════════════════════════════════

function makeCtx(
  score: Score,
  selection: Selection,
): { ctx: KeyboardHandlerContext; latest: () => Score; selectionCalls: () => string[] } {
  let current = score;
  const calls: string[] = [];
  const ctx = {
    getScore: () => current,
    getSelection: () => selection,
    updateScore: (next: Score) => {
      current = next;
    },
    selectElement: (id: string) => {
      calls.push(`select:${id}`);
    },
    clearSelection: () => {
      calls.push("clear");
    },
  } as unknown as KeyboardHandlerContext;
  return { ctx, latest: () => current, selectionCalls: () => calls };
}

const noopEvent = { preventDefault() {} } as unknown as KeyboardEvent;

describe("handleDelete — articulations", () => {
  it("strips the marking and leaves the note intact", () => {
    const sel: Selection = { kind: "single", elementId: ACCENT };
    const { ctx, latest } = makeCtx(makeScore({ accent: {}, tenuto: {} }), sel);
    handleDelete(noopEvent, false, ctx);

    const ev = eventOf(latest());
    expect(ev.rest).toBeUndefined();
    expect(ev.markings?.accent).toBeUndefined();
    expect(ev.markings?.tenuto).toBeDefined();
  });

  it("still blanks the event when the notehead is selected", () => {
    const sel: Selection = { kind: "single", elementId: "p0/m0/s0/e1/n0" };
    const { ctx, latest } = makeCtx(makeScore({ accent: {} }), sel);
    handleDelete(noopEvent, false, ctx);

    expect(latest().parts[0]!.measures[0]!.sequences[0]).toEqual({
      content: [],
      fullMeasure: { visualDuration: { base: "whole" } },
    });
  });

  it("clears the selection rather than falling back to the note", () => {
    const sel: Selection = { kind: "single", elementId: ACCENT };
    const { ctx, selectionCalls } = makeCtx(makeScore({ accent: {} }), sel);
    handleDelete(noopEvent, false, ctx);
    expect(selectionCalls()).toEqual(["clear"]);
  });

  it("leaves the selection alone when there was nothing to delete", () => {
    const sel: Selection = { kind: "single", elementId: ACCENT };
    const { ctx, selectionCalls } = makeCtx(makeScore({ tenuto: {} }), sel);
    handleDelete(noopEvent, false, ctx);
    expect(selectionCalls()).toEqual([]);
  });
});
