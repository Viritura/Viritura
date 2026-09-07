import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import {
  resolveNotationSelectionTarget,
  setFermataProperties,
  setMeasureNumber,
  setPrimaryNoteAlter,
} from "../commands/notationInspectorCommands";
import type { FermataDuration, FermataSymbol, Orientation } from "@viritura/core";
import { parseMnx, serializeMnx } from "@viritura/format";
import { createHistoryStore } from "../store/historyStore";

function buildScore(): Score {
  return JSON.parse(
    JSON.stringify({
      mnx: { version: 1 },
      global: {
        measures: [{ _x: { viritura: { keepMe: true } } }],
      },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event",
                      id: "ev1",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  ) as Score;
}

describe("notationInspectorCommands", () => {
  it("resolves event and measure selection targets", () => {
    const score = buildScore();
    const eventTarget = resolveNotationSelectionTarget(
      { kind: "single", elementId: "p0/m0/s0/ev1", elementType: "event" },
      score,
    );
    const measureTarget = resolveNotationSelectionTarget(
      { kind: "single", elementId: "m0/time", elementType: "time-signature" },
      score,
    );
    expect(eventTarget?.eventIndex).toBe(0);
    expect(measureTarget?.measureIndex).toBe(0);
  });

  it("retains the selected note index for a chord notehead", () => {
    const score = buildScore();
    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (event.type !== "event") throw new Error("expected note event");
    event.notes!.push({ pitch: { step: "E", octave: 4 } });

    const target = resolveNotationSelectionTarget(
      { kind: "single", elementId: "p0/m0/s0/ev1/n1", elementType: "notehead" },
      score,
    );

    expect(target?.noteIndex).toBe(1);
  });

  it("preserves unknown measure fields while editing measure number", () => {
    const score = buildScore();
    const target = resolveNotationSelectionTarget(
      { kind: "single", elementId: "m0/time", elementType: "time-signature" },
      score,
    )!;
    const result = setMeasureNumber(score, target, "12");
    expect(result.ok).toBe(true);
    const measure = result.score!.global.measures[0] as Record<string, unknown>;
    expect(measure.number).toBe(12);
    expect(measure._x).toBeTruthy();
  });

  it("validates note alter range", () => {
    const score = buildScore();
    const target = resolveNotationSelectionTarget(
      { kind: "single", elementId: "p0/m0/s0/ev1", elementType: "event" },
      score,
    )!;
    const invalid = setPrimaryNoteAlter(score, target, "5");
    expect(invalid.ok).toBe(false);
  });

  it.each([
    "normal",
    "angled",
    "square",
    "doubleAngled",
    "doubleSquare",
    "doubleDot",
    "halfCurve",
    "curlew",
  ] satisfies FermataSymbol[])("edits a selected fermata to the %s symbol", (symbol) => {
    const score = buildScore();
    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (event.type !== "event") throw new Error("expected note event");
    event.fermata = {};
    const target = resolveNotationSelectionTarget(
      { kind: "single", elementId: "p0/m0/s0/ev1/fermata", elementType: "fermata" },
      score,
    )!;

    const result = setFermataProperties(score, target, { symbol });

    const edited = result.score!.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(edited.type === "event" ? edited.fermata?.symbol : undefined).toBe(symbol);
    expect(event.fermata).toEqual({});
  });

  it.each([
    "auto",
    "none",
    "veryShort",
    "short",
    "normal",
    "long",
    "veryLong",
  ] satisfies FermataDuration[])("edits and reopens a selected fermata with %s duration", (duration) => {
    const score = buildScore();
    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (event.type !== "event") throw new Error("expected note event");
    event.fermata = {};
    const target = resolveNotationSelectionTarget(
      { kind: "single", elementId: "p0/m0/s0/ev1/fermata", elementType: "fermata" },
      score,
    )!;

    const result = setFermataProperties(score, target, { duration });
    const reopened = parseMnx(serializeMnx(result.score!));
    const reopenedEvent = reopened.parts[0]!.measures[0]!.sequences[0]!.content[0]!;

    expect(reopenedEvent.type === "event" ? reopenedEvent.fermata?.duration : undefined).toBe(duration);
  });

  it.each(["auto", "above", "below"] satisfies Orientation[])(
    "edits and reopens a selected fermata with %s orientation",
    (orient) => {
      const score = buildScore();
      const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
      if (event.type !== "event") throw new Error("expected note event");
      event.fermata = {};
      const target = resolveNotationSelectionTarget(
        { kind: "single", elementId: "p0/m0/s0/ev1/fermata", elementType: "fermata" },
        score,
      )!;

      const result = setFermataProperties(score, target, { orient });
      const reopened = parseMnx(serializeMnx(result.score!));
      const reopenedEvent = reopened.parts[0]!.measures[0]!.sequences[0]!.content[0]!;

      expect(reopenedEvent.type === "event" ? reopenedEvent.fermata?.orient : undefined).toBe(orient);
    },
  );

  it("preserves a fermata edit through serialization, undo, redo, and reopen", () => {
    const score = buildScore();
    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    if (event.type !== "event") throw new Error("expected note event");
    event.fermata = { symbol: "normal" };
    const target = resolveNotationSelectionTarget(
      { kind: "single", elementId: "p0/m0/s0/ev1/fermata", elementType: "fermata" },
      score,
    )!;
    const edited = setFermataProperties(score, target, {
      symbol: "doubleSquare",
      duration: "veryLong",
      orient: "below",
    }).score!;
    const initialJson = JSON.stringify(serializeMnx(score));
    const editedJson = JSON.stringify(serializeMnx(edited));
    const history = createHistoryStore(initialJson, { current: undefined });
    history.getState().pushState(editedJson, "Edit fermata");

    expect(history.getState().undo()).toBe(initialJson);
    const reopenedInitial = parseMnx(JSON.parse(initialJson));
    const initialEvent = reopenedInitial.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(initialEvent.type === "event" ? initialEvent.fermata : undefined).toEqual({ symbol: "normal" });

    const reopenedEdited = parseMnx(JSON.parse(history.getState().redo()!));
    const editedEvent = reopenedEdited.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(editedEvent.type === "event" ? editedEvent.fermata : undefined).toEqual({
      symbol: "doubleSquare",
      duration: "veryLong",
      orient: "below",
    });
  });
});
