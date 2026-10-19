import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { toggleNavigationMarker, setNavigationMarkerProperties, JUMP_LABELS } from "./index";
import { deleteAnnotation } from "../deleteCommands";
import { resolveRepeat } from "../../radialMenu/repeatMenu";
import { createHistoryStore } from "../../store/historyStore";
import { parseMnx, serializeMnx } from "@viritura/format";

function score(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
    parts: [
      {
        measures: [0, 1].map(() => ({
          sequences: [
            {
              content: [0, 1, 2, 3].map((n) => ({
                type: "event" as const,
                id: `e${n}`,
                duration: { base: "quarter" as const },
                notes: [{ pitch: { step: "C" as const, octave: 4 as const } }],
              })),
            },
          ],
        })),
      },
    ],
  };
}
const selection = { kind: "single" as const, elementId: "p0/m0/s0/e1", elementType: "note" as const };

describe("native navigation authoring", () => {
  it.each(Object.keys(JUMP_LABELS) as Array<keyof typeof JUMP_LABELS>)(
    "authors and deletes %s at the selected end",
    (type) => {
      const original = score();
      expect(resolveRepeat(`jump-${type}`)).toEqual({ kind: "jump", type });
      const next = toggleNavigationMarker(original, selection, { kind: "jump", type });
      expect(next.global.measures[0]!.jump).toEqual({ type, location: { fraction: [1, 2] } });
      expect(original.global.measures[0]!.jump).toBeUndefined();
      expect(
        deleteAnnotation(next, { kind: "global", type: "jump", measureIndex: 0 })?.global.measures[0]!.jump,
      ).toBeUndefined();
      expect(toggleNavigationMarker(next, selection, { kind: "jump", type }).global.measures[0]!.jump).toBeUndefined();
    },
  );

  it("places destinations at the event onset and Fine at its end", () => {
    for (const kind of ["segno", "coda", "fine"] as const) {
      const next = toggleNavigationMarker(score(), selection, { kind });
      expect(next.global.measures[0]![kind]?.location.fraction).toEqual(kind === "fine" ? [1, 2] : [1, 4]);
    }
  });

  it("uses the correct side of a selected barline", () => {
    const barline = { kind: "single" as const, elementId: "m1/barline", elementType: "barline" as const };
    const next = toggleNavigationMarker(score(), barline, { kind: "coda" });
    expect(next.global.measures[1]!.coda?.location.fraction).toEqual([0, 1]);
    const jump = toggleNavigationMarker(next, barline, { kind: "jump", type: "dc" });
    expect(jump.global.measures[0]!.jump?.location.fraction).toEqual([4, 4]);
  });

  it("uses scaled tuplet beats rather than unscaled child durations", () => {
    const source = score();
    const content = source.parts[0]!.measures[0]!.sequences[0]!.content;
    content.splice(1, 3, {
      type: "tuplet",
      inner: { multiple: 3, duration: { base: "eighth" } },
      outer: { multiple: 2, duration: { base: "eighth" } },
      content: [0, 1, 2].map((n) => ({
        type: "event",
        id: `triplet-${n}`,
        duration: { base: "eighth" },
        notes: [{ pitch: { step: "C", octave: 4 } }],
      })),
    });

    const selected = { ...selection, elementId: "p0/m0/s0/triplet-1" };
    expect(
      toggleNavigationMarker(source, selected, { kind: "segno" }).global.measures[0]!.segno?.location.fraction,
    ).toEqual([1, 3]);
    expect(
      toggleNavigationMarker(source, selected, { kind: "jump", type: "dc" }).global.measures[0]!.jump?.location
        .fraction,
    ).toEqual([5, 12]);
  });

  it("authors concluding instructions at the end of an implicit full-measure rest", () => {
    const source = score();
    source.parts[0]!.measures[0]!.sequences = [{ fullMeasure: true, content: [] }];
    const rest = { ...selection, elementId: "p0/m0/s0/e0" };
    expect(toggleNavigationMarker(source, rest, { kind: "fine" }).global.measures[0]!.fine?.location.fraction).toEqual([
      4, 4,
    ]);
  });

  it("preserves authored marker text while changing route, position, glyph, and color", () => {
    const original = score();
    original.global.measures[0]!.jump = {
      type: "dc",
      location: { fraction: [1, 1] },
      text: {
        content: [{ text: "with repeats" }],
        placement: "after",
      },
    };
    const next = toggleNavigationMarker(original, selection, { kind: "jump", type: "dsAlFine" });
    expect(next.global.measures[0]!.jump?.text).toEqual(original.global.measures[0]!.jump?.text);
    let destination = toggleNavigationMarker(next, selection, { kind: "coda" });
    destination = setNavigationMarkerProperties(destination, 0, "coda", {
      location: { fraction: [3, 4] },
      glyph: "codaSquare",
      color: "#ff0000",
    });
    expect(destination.global.measures[0]!.coda).toEqual({
      location: { fraction: [3, 4] },
      glyph: "codaSquare",
      color: "#ff0000",
    });
    expect(setNavigationMarkerProperties(destination, 0, "coda", { location: { fraction: [1, 0] } })).toBe(destination);
  });

  it("round-trips native coda and marker text across deletion, undo, and redo", () => {
    const original = score();
    original.global.measures[0]!.coda = {
      location: { fraction: [1, 4] },
      glyph: "codaSquare",
      color: "#ff0000",
      text: { content: [{ text: "ending" }], placement: "after" },
    };
    const initial = JSON.stringify(serializeMnx(original));
    let restored = original;
    const history = createHistoryStore(initial, {
      current: (json) => {
        restored = parseMnx(JSON.parse(json));
      },
    });
    const deleted = deleteAnnotation(original, { kind: "global", type: "coda", measureIndex: 0 })!;
    history.getState().pushState(JSON.stringify(serializeMnx(deleted)), "Delete coda");
    history.getState().undo();
    expect(restored.global.measures[0]!.coda).toEqual(original.global.measures[0]!.coda);
    history.getState().redo();
    expect(restored.global.measures[0]!.coda).toBeUndefined();
    expect(restored.global.measures[0]!.jump).toBeUndefined();
  });
});
