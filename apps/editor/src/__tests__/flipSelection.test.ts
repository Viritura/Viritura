import { describe, expect, it } from "vitest";
import type { DynamicGroup, NoteEvent, Score, Tuplet } from "@viritura/core";

import { handleFlip } from "../keyboard/normalModeHandlers";
import type { KeyboardHandlerContext } from "../keyboard/types";
import { parseElementType } from "../score/elementTypes";
import type { Selection } from "../store/selectionStore";

function note(id: string, step: "C" | "D" | "E" = "C"): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base: "quarter" },
    notes: [{ id: `${id}-note`, pitch: { step, octave: 4 } }],
  };
}

function makeTuplet(): Tuplet {
  return {
    type: "tuplet",
    outer: { duration: { base: "quarter" }, multiple: 1 },
    inner: { duration: { base: "eighth" }, multiple: 3 },
    content: [note("triplet-0"), note("triplet-1"), note("triplet-2")],
  };
}

function makeScore(): Score {
  const source = note("source");
  source.slurs = [{ target: "target" }];
  source.notes![0]!.ties = [{ target: "target-note" }];
  source.markings = { staccato: {}, trill: {} };
  source.fermata = {};

  const immediate: DynamicGroup = {
    id: "dynamic-id",
    type: "immediate",
    position: { fraction: [0, 1] },
    value: "p",
  };
  const gradual: DynamicGroup = {
    id: "hairpin-id",
    type: "gradual",
    position: { fraction: [0, 1] },
    end: { measure: "m0", position: { fraction: [1, 1] } },
    wedgeType: "increasing",
  };

  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m0" }] },
    parts: [
      {
        name: "Violin",
        measures: [
          {
            sequences: [{ content: [source, note("target", "D"), makeTuplet()] }],
            dynamics: [immediate, gradual],
            ottavas: [
              {
                position: { fraction: [0, 1] },
                end: { measure: "m0", position: { fraction: [1, 1] } },
                value: 1,
              },
            ],
            expressions: [{ text: "dolce", position: { fraction: [0, 1] } }],
          },
        ],
      },
    ],
  };
}

function single(elementId: string): Selection {
  return { kind: "single", elementId, elementType: parseElementType(elementId) };
}

function makeContext(score: Score, selection: Selection): { ctx: KeyboardHandlerContext; latest: () => Score } {
  let current = score;
  const ctx = {
    getScore: () => current,
    getSelection: () => selection,
    updateScore: (next: Score) => {
      current = next;
    },
  } as unknown as KeyboardHandlerContext;
  return { ctx, latest: () => current };
}

function sourceEvent(score: Score): NoteEvent {
  return score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
}

describe("context-sensitive F flip", () => {
  it("preserves stem flipping for selected events", () => {
    const { ctx, latest } = makeContext(makeScore(), single("p0/m0/s0/source"));

    expect(handleFlip(ctx)).toBe(true);

    expect(sourceEvent(latest()).orient).toBe("below");
  });

  it("flips an automatic slur to the opposite explicit side", () => {
    const { ctx, latest } = makeContext(makeScore(), single("slur/source/target"));

    expect(handleFlip(ctx)).toBe(true);

    expect(sourceEvent(latest()).slurs![0]).toMatchObject({ side: "up", sideEnd: "up" });
  });

  it("flips an automatic tie to the opposite explicit side", () => {
    const { ctx, latest } = makeContext(makeScore(), single("tie/source-note/target-note"));

    expect(handleFlip(ctx)).toBe(true);

    expect(sourceEvent(latest()).notes![0]!.ties![0]!.side).toBe("up");
  });

  it("flips tuplet placement using the rendered tuplet ordinal", () => {
    const { ctx, latest } = makeContext(makeScore(), single("p0/m0/s0/tuplet0"));

    expect(handleFlip(ctx)).toBe(true);

    const tuplet = latest().parts[0]!.measures[0]!.sequences[0]!.content[2] as Tuplet;
    expect(tuplet.orient).toBe("below");
  });

  it("flips a selected articulation without flipping its note stem", () => {
    const { ctx, latest } = makeContext(makeScore(), single("p0/m0/s0/source/art-staccato"));

    expect(handleFlip(ctx)).toBe(true);

    expect(sourceEvent(latest()).markings!.staccato!.orient).toBe("above");
    expect(sourceEvent(latest()).orient).toBeUndefined();
  });

  it("flips a selected fermata", () => {
    const { ctx, latest } = makeContext(makeScore(), single("p0/m0/s0/source/ferm"));

    expect(handleFlip(ctx)).toBe(true);

    expect(sourceEvent(latest()).fermata!.orient).toBe("below");
  });

  it.each([
    ["dynamic", "p0/m0/dyndynamic-id", 0],
    ["hairpin", "p0/m0/hairpinhairpin-id", 1],
  ])("flips a selected %s above the staff", (_name, elementId, dynamicIndex) => {
    const { ctx, latest } = makeContext(makeScore(), single(elementId));

    expect(handleFlip(ctx)).toBe(true);

    expect(latest().parts[0]!.measures[0]!.dynamics![dynamicIndex]!.orient).toBe("above");
  });

  it("flips a positive ottava from its automatic above placement to below", () => {
    const { ctx, latest } = makeContext(makeScore(), single("p0/m0/ottava0"));

    expect(handleFlip(ctx)).toBe(true);

    expect(latest().parts[0]!.measures[0]!.ottavas![0]!.orient).toBe("below");
  });

  it("flips a text expression from its default below placement to above", () => {
    const { ctx, latest } = makeContext(makeScore(), single("p0/m0/expr0"));

    expect(handleFlip(ctx)).toBe(true);

    expect(latest().parts[0]!.measures[0]!.expressions![0]!.placement).toBe("above");
  });

  it("does not turn unsupported ornament selection into a stem flip", () => {
    const score = makeScore();
    const { ctx, latest } = makeContext(score, single("p0/m0/s0/source/trill"));

    expect(handleFlip(ctx)).toBe(false);
    expect(latest()).toBe(score);
    expect(sourceEvent(latest()).orient).toBeUndefined();
  });
});
