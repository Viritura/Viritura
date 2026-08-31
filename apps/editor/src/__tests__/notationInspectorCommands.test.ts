import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import {
  resolveNotationSelectionTarget,
  setMeasureNumber,
  setPrimaryNoteAlter,
} from "../commands/notationInspectorCommands";

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
});
