/**
 * Delete must never destroy an object the user did not select.
 *
 * `resolveEventLocation` reads only the first four path segments and ignores
 * the rest, so any longer id resolves to its event. Every delete path that
 * falls through to event deletion therefore has to gate on the id actually
 * addressing an event — otherwise a fingering, an augmentation dot, or a typo
 * silently blanks the note it sits on.
 */

import { describe, it, expect } from "vitest";
import type { NoteEvent, Score } from "@viritura/core";
import type { Selection } from "../store/selectionStore";
import type { KeyboardHandlerContext } from "../keyboard/types";
import { handleDelete } from "../keyboard/normalModeDelete";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";
import { addressesWholeEvent } from "../score/ElementPath";

const EVENT = "p0/m0/s0/e1";

function makeScore(): Score {
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
                    duration: { base: "quarter", dots: 1 },
                    notes: [{ pitch: { step: "C", octave: 4, alter: 1 } }],
                    markings: { accent: {}, fingerings: [{ digit: "3" }] },
                  },
                  {
                    type: "event",
                    id: "e2",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { step: "E", octave: 4 } }],
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

function eventAt(score: Score, index: number): NoteEvent {
  return score.parts[0]!.measures[0]!.sequences[0]!.content[index] as NoteEvent;
}

function makeCtx(score: Score, selection: Selection): { ctx: KeyboardHandlerContext; latest: () => Score } {
  let current = score;
  const ctx = {
    getScore: () => current,
    getSelection: () => selection,
    updateScore: (next: Score) => {
      current = next;
    },
    selectElement: () => {},
    clearSelection: () => {},
  } as unknown as KeyboardHandlerContext;
  return { ctx, latest: () => current };
}

const noopEvent = { preventDefault() {} } as unknown as KeyboardEvent;

describe("addressesWholeEvent", () => {
  it("accepts the event itself", () => {
    expect(addressesWholeEvent(EVENT)).toBe(true);
  });

  it("accepts a notehead — a chord note is deletable in its own right", () => {
    expect(addressesWholeEvent(`${EVENT}/n0`)).toBe(true);
    expect(addressesWholeEvent(`${EVENT}/n12`)).toBe(true);
  });

  it("rejects every other sub-element", () => {
    for (const suffix of ["acc0", "art-accent", "fing0", "arp", "lyric0", "trem", "ferm"]) {
      expect(addressesWholeEvent(`${EVENT}/${suffix}`)).toBe(false);
    }
    expect(addressesWholeEvent(`${EVENT}/dot/0/0`)).toBe(false);
  });

  it("rejects ids it doesn't recognise at all", () => {
    expect(addressesWholeEvent(`${EVENT}/totalNonsense`)).toBe(false);
  });
});

describe("delete never blanks a note from an unhandled sub-element", () => {
  // Fingerings, augmentation dots and lyrics have ids but no delete handler.
  // Until they get one, Delete on them must do nothing.
  const unhandled = [`${EVENT}/fing0`, `${EVENT}/dot/0/0`, `${EVENT}/lyric0`, `${EVENT}/totalNonsense`];

  for (const id of unhandled) {
    it(`is a no-op for ${id} (computeDeleteSelection)`, () => {
      expect(computeDeleteSelection(makeScore(), { kind: "single", elementId: id } as never).kind).toBe("noop");
    });

    it(`is a no-op for ${id} (keyboard Delete)`, () => {
      const { ctx, latest } = makeCtx(makeScore(), { kind: "single", elementId: id });
      handleDelete(noopEvent, false, ctx);
      expect(eventAt(latest(), 0).rest).toBeUndefined();
      expect(eventAt(latest(), 0).notes).toHaveLength(1);
    });
  }

  it("still deletes the note from the event id itself", () => {
    const { ctx, latest } = makeCtx(makeScore(), { kind: "single", elementId: EVENT });
    handleDelete(noopEvent, false, ctx);
    expect(eventAt(latest(), 0).rest).toBeDefined();
  });

  it("still deletes the note from a notehead id when it's the event's only note", () => {
    const { ctx, latest } = makeCtx(makeScore(), { kind: "single", elementId: `${EVENT}/n0` });
    handleDelete(noopEvent, false, ctx);
    expect(eventAt(latest(), 0).rest).toBeDefined();
  });
});

describe("multi-selection delete keeps markings separate from events", () => {
  it("strips an accidental without blanking its note", () => {
    const result = computeDeleteSelection(makeScore(), {
      kind: "multi",
      elementIds: [`${EVENT}/acc0`],
    } as never);

    const ev = eventAt((result as { score: Score }).score, 0);
    expect(ev.rest).toBeUndefined();
    expect(ev.notes![0]!.pitch.alter).toBeUndefined();
  });

  it("strips an articulation without blanking its note", () => {
    const result = computeDeleteSelection(makeScore(), {
      kind: "multi",
      elementIds: [`${EVENT}/art-accent`],
    } as never);

    const ev = eventAt((result as { score: Score }).score, 0);
    expect(ev.rest).toBeUndefined();
    expect(ev.markings?.accent).toBeUndefined();
  });

  it("handles a mixed selection: marking stripped, event blanked", () => {
    const result = computeDeleteSelection(makeScore(), {
      kind: "multi",
      elementIds: [`${EVENT}/acc0`, "p0/m0/s0/e2"],
    } as never);
    const score = (result as { score: Score }).score;

    // e1 keeps its note, minus the accidental.
    expect(eventAt(score, 0).rest).toBeUndefined();
    expect(eventAt(score, 0).notes![0]!.pitch.alter).toBeUndefined();
    // e2 was selected as an event, so it blanks.
    expect(eventAt(score, 1).rest).toBeDefined();
  });

  it("is a no-op when the only selected marking isn't there", () => {
    const score = makeScore();
    delete (eventAt(score, 0).notes![0]!.pitch as { alter?: number }).alter;
    expect(computeDeleteSelection(score, { kind: "multi", elementIds: [`${EVENT}/acc0`] } as never).kind).toBe("noop");
  });

  it("keyboard Delete strips a multi-selected accidental without blanking", () => {
    const { ctx, latest } = makeCtx(makeScore(), { kind: "multi", elementIds: [`${EVENT}/acc0`] });
    handleDelete(noopEvent, false, ctx);

    expect(eventAt(latest(), 0).rest).toBeUndefined();
    expect(eventAt(latest(), 0).notes![0]!.pitch.alter).toBeUndefined();
  });

  it("keyboard Delete handles a mixed multi-selection", () => {
    const { ctx, latest } = makeCtx(makeScore(), {
      kind: "multi",
      elementIds: [`${EVENT}/art-accent`, "p0/m0/s0/e2"],
    });
    handleDelete(noopEvent, false, ctx);

    expect(eventAt(latest(), 0).rest).toBeUndefined();
    expect(eventAt(latest(), 0).markings?.accent).toBeUndefined();
    expect(eventAt(latest(), 1).rest).toBeDefined();
  });
});
