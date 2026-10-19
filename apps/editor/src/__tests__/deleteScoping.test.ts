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
import { parseChordSymbolText } from "@viritura/core";
import type { Selection } from "../store/selectionStore";
import type { KeyboardHandlerContext } from "../keyboard/types";
import { handleDelete } from "../keyboard/normalModeDelete";
import { computeDeleteSelection } from "../commands/computeDeleteSelection";
import { addressesWholeEvent } from "../score/ElementPath";
import { lyricElementId } from "../score/ElementPath";

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
                    lyrics: { lines: { "1": { text: "Sing" } } },
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
    getConfig: () => ({ selectedScoreIndex: 0 }),
    updateScore: (next: Score) => {
      current = next;
    },
    selectElement: () => {},
    clearSelection: () => {},
  } as unknown as KeyboardHandlerContext;
  return { ctx, latest: () => current };
}

const noopEvent = { preventDefault() {} } as unknown as KeyboardEvent;

describe("global chord keyboard deletion", () => {
  it.each(["m0/chord0", "m0/chord0/p0/staff1"])("deletes %s without touching notes", (elementId) => {
    const score = makeScore();
    score.global.measures[0]!.chordSymbols = [parseChordSymbolText("C", { fraction: [0, 1] })];
    const { ctx, latest } = makeCtx(score, { kind: "single", elementId, elementType: "chord-symbol" });
    handleDelete(noopEvent, false, ctx);
    expect(latest().global.measures[0]!.chordSymbols).toBeUndefined();
    expect(latest().parts).toEqual(score.parts);
    expect(score.global.measures[0]!.chordSymbols).toHaveLength(1);
  });

  it("deduplicates selected render copies before shifting global chord indices", () => {
    const score = makeScore();
    const retained = parseChordSymbolText("G", { fraction: [1, 2] });
    score.global.measures[0]!.chordSymbols = [parseChordSymbolText("C", { fraction: [0, 1] }), retained];
    const { ctx, latest } = makeCtx(score, {
      kind: "multi",
      elementIds: ["m0/chord0", "m0/chord0/p0/staff1", "m0/chord0/p0/staff2"],
    });
    handleDelete(noopEvent, false, ctx);
    expect(latest().global.measures[0]!.chordSymbols).toEqual([retained]);
    expect(latest().parts).toEqual(score.parts);
  });
});

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
  // Fingerings and augmentation dots have ids but no delete handler. Until
  // they get one, Delete on them must do nothing.
  const unhandled = [`${EVENT}/fing0`, `${EVENT}/dot/0/0`, `${EVENT}/lyric0`, `${EVENT}/totalNonsense`];

  for (const id of unhandled) {
    it(`is a no-op for ${id} (computeDeleteSelection)`, () => {
      expect(computeDeleteSelection(makeScore(), { kind: "single", elementId: id } as never).kind).toBe("noop");
    });

    describe("lyric deletion", () => {
      const lyricId = lyricElementId(EVENT, "1");

      it("removes only the selected lyric through the pure delete command", () => {
        const result = computeDeleteSelection(makeScore(), { kind: "single", elementId: lyricId } as never);
        expect(result.kind).toBe("single");
        if (result.kind !== "single") return;
        expect(eventAt(result.score, 0).lyrics).toBeUndefined();
        expect(eventAt(result.score, 0).notes).toHaveLength(1);
      });

      it("removes only the selected lyric through keyboard Delete", () => {
        const { ctx, latest } = makeCtx(makeScore(), { kind: "single", elementId: lyricId });
        handleDelete(noopEvent, false, ctx);
        expect(eventAt(latest(), 0).lyrics).toBeUndefined();
        expect(eventAt(latest(), 0).notes).toHaveLength(1);
        expect(eventAt(latest(), 0).rest).toBeUndefined();
      });
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
  it.each(["slideIn", "slideOut"] as const)(
    "deletes selected %s in both delete paths without touching notes",
    (key) => {
      for (const multi of [false, true]) {
        const score = makeScore();
        const event = eventAt(score, 0);
        event.notes![0]!.markings = { slideIn: { type: "scoop" }, slideOut: { type: "doit" } };
        event.notes!.push({
          pitch: { step: "G", octave: 4 },
          markings: { slideIn: { type: "plop" }, slideOut: { type: "falloff" } },
        });
        const original = structuredClone(score);
        const id = `${EVENT}/n0/${key}`;
        const selection: Selection = multi
          ? { kind: "multi", elementIds: [id, id] }
          : { kind: "single", elementId: id, elementType: "note-marking" };
        const result = computeDeleteSelection(score, selection);
        expect(result.kind).toBe(multi ? "multi" : "single");
        if (result.kind === "noop" || result.kind === "measure") throw new Error("Expected leaf deletion");
        expect(result.nextSelection).toEqual({ kind: "clear" });
        const { ctx, latest } = makeCtx(score, selection);
        handleDelete(noopEvent, false, ctx);
        for (const updated of [result.score, latest()]) {
          const expected = structuredClone(original);
          delete eventAt(expected, 0).notes![0]!.markings![key];
          expect(updated).toEqual(expected);
        }
        expect(score).toEqual(original);
      }
    },
  );

  it("removes an empty note markings bag and ignores stale selections", () => {
    const score = makeScore();
    eventAt(score, 0).notes![0]!.markings = { slideIn: { type: "scoop" } };
    const selection: Selection = { kind: "single", elementId: `${EVENT}/n0/slideIn` };
    const { ctx, latest } = makeCtx(score, selection);
    handleDelete(noopEvent, false, ctx);
    expect(eventAt(latest(), 0).notes![0]!.markings).toBeUndefined();
    expect(computeDeleteSelection(latest(), selection)).toEqual({ kind: "noop" });
    expect(eventAt(latest(), 0).markings?.accent).toEqual({});
  });

  it("removes markings before selected chord notes shift their indices", () => {
    const score = makeScore();
    eventAt(score, 0).notes!.push({
      pitch: { step: "G", octave: 4 },
      markings: { slideOut: { type: "falloff" } },
    });
    const selection: Selection = {
      kind: "multi",
      elementIds: [`${EVENT}/n0`, `${EVENT}/n1/slideOut`, "p0/m0/s0/e2"],
    };
    const result = computeDeleteSelection(score, selection);
    if (result.kind !== "multi") throw new Error("Expected multi deletion");
    const { ctx, latest } = makeCtx(score, selection);
    handleDelete(noopEvent, false, ctx);
    for (const updated of [result.score, latest()]) {
      expect(eventAt(updated, 0).notes).toEqual([{ pitch: { step: "G", octave: 4 } }]);
      expect(eventAt(updated, 1).rest).toBeDefined();
    }
  });

  it("resolves note markings inside tuplets", () => {
    const score = makeScore();
    const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
    const event = eventAt(score, 0);
    event.notes![0]!.markings = { slideOut: { type: "doit" } };
    sequence.content = [
      {
        type: "tuplet",
        inner: { duration: { base: "eighth" }, multiple: 3 },
        outer: { duration: { base: "eighth" }, multiple: 2 },
        content: [event],
      },
    ];
    const selection: Selection = { kind: "single", elementId: `${EVENT}/n0/slideOut` };
    const result = computeDeleteSelection(score, selection);
    if (result.kind !== "single") throw new Error("Expected single deletion");
    const { ctx, latest } = makeCtx(score, selection);
    handleDelete(noopEvent, false, ctx);
    expect(latest()).toEqual(result.score);
    const tuplet = latest().parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (tuplet.type !== "tuplet") throw new Error("Expected tuplet");
    expect(tuplet.content[0]!.notes![0]!.markings).toBeUndefined();
    expect(tuplet.content[0]!.notes).toHaveLength(1);
  });

  it("deletes a grace note marking without deleting the grace or principal notes", () => {
    const score = makeScore();
    const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
    sequence.content.unshift({
      type: "grace",
      content: [
        {
          type: "event",
          id: "grace-note",
          duration: { base: "eighth" },
          notes: [{ pitch: { step: "B", octave: 4 }, markings: { slideIn: { type: "scoop" } } }],
        },
      ],
    });
    const original = structuredClone(score);
    for (const multi of [false, true]) {
      const elementId = `${EVENT}/grace/grace-note/n0/slideIn`;
      const selection: Selection = multi ? { kind: "multi", elementIds: [elementId] } : { kind: "single", elementId };
      const result = computeDeleteSelection(score, selection);
      if (result.kind === "noop" || result.kind === "measure") throw new Error("Expected leaf deletion");
      const { ctx, latest } = makeCtx(score, selection);
      handleDelete(noopEvent, false, ctx);
      const expected = structuredClone(score);
      const grace = expected.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
      if (grace.type !== "grace") throw new Error("Expected grace group");
      delete grace.content[0]!.notes![0]!.markings;
      expect(result.score).toEqual(expected);
      expect(latest()).toEqual(expected);
      expect(score).toEqual(original);
    }
  });

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
