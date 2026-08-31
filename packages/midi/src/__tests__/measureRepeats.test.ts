import { describe, it, expect } from "vitest";
import type { MeasureRepeat, PartMeasure, Score } from "@viritura/core";
import { expandMeasureRepeats } from "../measureRepeats";
import { generateTimeline } from "../timeline";

function noteMeasure(step: string, id: string): PartMeasure {
  return {
    sequences: [
      {
        content: [
          {
            type: "event",
            id,
            duration: { base: "whole" },
            notes: [{ id: `${id}-n`, pitch: { step, octave: 4, alter: 0 } }],
          },
        ],
      },
    ],
  } as unknown as PartMeasure;
}

function repeatMeasure(measureRepeat: MeasureRepeat): PartMeasure {
  return { sequences: [{ content: [] }], measureRepeat } as unknown as PartMeasure;
}

function buildScore(measures: PartMeasure[]): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: measures.map(() => ({
        time: { count: 4, unit: 4 },
        tempos: [{ bpm: 120, value: { base: "quarter" } } as never],
      })),
    },
    parts: [{ id: "p1", name: "Violin", measures }],
  } as unknown as Score;
}

describe("expandMeasureRepeats", () => {
  it("leaves a part without simile marks untouched", () => {
    const part = buildScore([noteMeasure("C", "e1"), noteMeasure("D", "e2")]).parts[0]!;
    expect(expandMeasureRepeats(part)).toBe(part);
  });

  it("substitutes the previous bar for a one-bar simile", () => {
    const part = buildScore([noteMeasure("C", "e1"), repeatMeasure({ number: 1 }), noteMeasure("G", "e3")]).parts[0]!;
    const expanded = expandMeasureRepeats(part);
    const repeated = expanded.measures[1]!;
    expect(repeated.measureRepeat).toBeUndefined();
    expect(repeated.sequences[0]!.content).toHaveLength(1);
    const [event] = repeated.sequences[0]!.content as [{ id: string; notes: { pitch: { step: string } }[] }];
    expect(event.notes[0]!.pitch.step).toBe("C");
    // Ids are rewritten so the clone never collides with its source.
    expect(event.id).not.toBe("e1");
  });

  it("spans both bars of a two-bar simile", () => {
    const part = buildScore([
      noteMeasure("C", "e1"),
      noteMeasure("D", "e2"),
      repeatMeasure({ number: 2 }),
      { sequences: [{ content: [] }] } as unknown as PartMeasure,
    ]).parts[0]!;
    const expanded = expandMeasureRepeats(part);
    const steps = expanded.measures.map(
      (m) =>
        (m.sequences[0]!.content[0] as { notes?: { pitch: { step: string } }[] } | undefined)?.notes?.[0]?.pitch.step,
    );
    expect(steps).toEqual(["C", "D", "C", "D"]);
  });

  it("resolves a simile that points at another simile", () => {
    const part = buildScore([noteMeasure("E", "e1"), repeatMeasure({ number: 1 }), repeatMeasure({ number: 1 })])
      .parts[0]!;
    const expanded = expandMeasureRepeats(part);
    const steps = expanded.measures.map(
      (m) =>
        (m.sequences[0]!.content[0] as { notes?: { pitch: { step: string } }[] } | undefined)?.notes?.[0]?.pitch.step,
    );
    expect(steps).toEqual(["E", "E", "E"]);
  });

  it("relinks cross-measure references within a repeated span", () => {
    const first = noteMeasure("C", "e1");
    const firstEvent = first.sequences[0]!.content[0]!;
    if (firstEvent.type === "event") firstEvent.slurs = [{ target: "e2" }];
    const part = buildScore([
      first,
      noteMeasure("D", "e2"),
      repeatMeasure({ number: 2 }),
      { sequences: [{ content: [] }] } as PartMeasure,
    ]).parts[0]!;

    const expanded = expandMeasureRepeats(part);
    const repeatedFirst = expanded.measures[2]!.sequences[0]!.content[0]!;
    const repeatedSecond = expanded.measures[3]!.sequences[0]!.content[0]!;
    expect(repeatedFirst.type).toBe("event");
    expect(repeatedSecond.type).toBe("event");
    if (repeatedFirst.type !== "event" || repeatedSecond.type !== "event") return;
    expect(repeatedFirst.id).toBe("e1~r2");
    expect(repeatedSecond.id).toBe("e2~r3");
    expect(repeatedFirst.slurs?.[0]?.target).toBe(repeatedSecond.id);
  });

  it("ignores a simile with no earlier music to repeat", () => {
    const part = buildScore([repeatMeasure({ number: 2 }), noteMeasure("C", "e2")]).parts[0]!;
    const expanded = expandMeasureRepeats(part);
    expect(expanded.measures[0]!.sequences[0]!.content).toHaveLength(0);
  });
});

describe("generateTimeline with measure repeats", () => {
  it("sounds the repeated bar's notes at the simile's own time", () => {
    const score = buildScore([noteMeasure("C", "e1"), repeatMeasure({ number: 1 })]);
    const timeline = generateTimeline(score);
    const noteOns = timeline.events.filter((e) => e.type === "noteOn");
    expect(noteOns).toHaveLength(2);
    expect(noteOns[0]!.midiNote).toBe(noteOns[1]!.midiNote);
    // 4/4 at 120 bpm: the second bar starts two seconds in (onset humanization
    // shifts each attack by a few milliseconds).
    expect(noteOns[1]!.time - noteOns[0]!.time).toBeCloseTo(2, 1);
  });

  it("maps expanded repeat passes back to their original score measures", () => {
    const score = buildScore([noteMeasure("C", "e1"), noteMeasure("D", "e2"), noteMeasure("E", "e3")]);
    score.global.measures[0]!.repeatStart = {};
    score.global.measures[1]!.repeatEnd = { times: 2 };

    const timeline = generateTimeline(score);

    expect(timeline.expandedMeasureToOriginal).toEqual([0, 1, 0, 1, 2]);
    expect(timeline.expandedMeasureToOriginal).toHaveLength(timeline.measureStartBeats.length);
  });
});
