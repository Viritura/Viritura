import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { planPatches } from "../planPatches";
import type { SpanPlan } from "../spanPlan";

const FOUR_FOUR = { count: 4, unit: 4 };
const THREE_FOUR = { count: 3, unit: 4 };

/** A score of `bars` empty measures, with 4/4 declared at the top. */
function emptyScore(bars: number): Score {
  return {
    mnxVersion: 1,
    global: {
      measures: Array.from({ length: bars }, (_, index) => (index === 0 ? { time: FOUR_FOUR } : {})),
    },
    parts: [
      {
        measures: Array.from({ length: bars }, () => ({ sequences: [{ content: [] }] })),
      },
    ],
  } as unknown as Score;
}

/** Put a note in one bar, so it counts as written music. */
function withMusicIn(score: Score, measureIndex: number): Score {
  const parts = structuredClone(score.parts);
  parts[0]!.measures[measureIndex] = {
    sequences: [
      {
        content: [{ type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] }],
      },
    ],
  } as never;
  return { ...score, parts };
}

function plan(segments: SpanPlan["segments"]): SpanPlan {
  return { fromSeconds: 0, toSeconds: 10, segments };
}

describe("tempo-only application", () => {
  it("writes the derived tempo as a quarter-note mark", () => {
    const result = planPatches({
      score: emptyScore(8),
      plan: plan([{ meter: FOUR_FOUR, bars: 5 }]),
      startMeasureIndex: 0,
      currentBars: 5,
      bpm: 120,
      changeStructure: false,
    });
    expect(result.patches).toEqual([
      {
        kind: "setGlobalMeasureField",
        measureIndex: 0,
        update: { field: "tempos", value: [{ bpm: 120, value: { base: "quarter" } }] },
      },
    ]);
  });

  it("says so when the plan does not fit the bars the span has", () => {
    // Silently applying only the tempo here would leave the composer believing
    // the span lands on the hit when it cannot.
    const result = planPatches({
      score: emptyScore(8),
      plan: plan([{ meter: FOUR_FOUR, bars: 6 }]),
      startMeasureIndex: 0,
      currentBars: 4,
      bpm: 120,
      changeStructure: false,
    });
    expect(result.warnings.join(" ")).toMatch(/6 bars but the span currently holds 4/);
    expect(result.insertedBars).toBe(0);
  });

  it("never touches structure without the opt-in", () => {
    const result = planPatches({
      score: emptyScore(8),
      plan: plan([{ meter: THREE_FOUR, bars: 9 }]),
      startMeasureIndex: 0,
      currentBars: 4,
      bpm: 120,
      changeStructure: false,
    });
    expect(result.patches.every((patch) => patch.kind === "setGlobalMeasureField")).toBe(true);
    expect(result.patches).toHaveLength(1);
  });
});

describe("structural application", () => {
  it("inserts the bars the plan needs", () => {
    const result = planPatches({
      score: emptyScore(8),
      plan: plan([{ meter: FOUR_FOUR, bars: 6 }]),
      startMeasureIndex: 2,
      currentBars: 4,
      bpm: 120,
      changeStructure: true,
    });
    expect(result.insertedBars).toBe(2);
    expect(result.patches).toContainEqual({
      kind: "insertMeasures",
      atIndex: 6,
      globalMeasures: [{}, {}],
    });
  });

  it("removes bars from the end of the span, not the start", () => {
    // Removing from the head would shift the span off its hit.
    const result = planPatches({
      score: emptyScore(8),
      plan: plan([{ meter: FOUR_FOUR, bars: 2 }]),
      startMeasureIndex: 2,
      currentBars: 4,
      bpm: 120,
      changeStructure: true,
    });
    expect(result.removedBars).toBe(2);
    expect(result.patches).toContainEqual({ kind: "removeMeasures", startIndex: 4, count: 2 });
  });

  it("writes meter only where it changes", () => {
    // The score is already in 4/4, so a 4/4 run needs no restatement.
    const result = planPatches({
      score: emptyScore(8),
      plan: plan([
        { meter: FOUR_FOUR, bars: 3 },
        { meter: THREE_FOUR, bars: 1 },
      ]),
      startMeasureIndex: 1,
      currentBars: 4,
      bpm: 120,
      changeStructure: true,
    });
    const timeChanges = result.patches.filter(
      (patch) => patch.kind === "setGlobalMeasureField" && patch.update.field === "time",
    );
    expect(timeChanges).toHaveLength(1);
    expect(timeChanges[0]).toMatchObject({ measureIndex: 4 });
  });

  it("restates a meter that differs from the one in force", () => {
    const result = planPatches({
      score: emptyScore(8),
      plan: plan([{ meter: THREE_FOUR, bars: 4 }]),
      startMeasureIndex: 1,
      currentBars: 4,
      bpm: 120,
      changeStructure: true,
    });
    const timeChanges = result.patches.filter(
      (patch) => patch.kind === "setGlobalMeasureField" && patch.update.field === "time",
    );
    expect(timeChanges).toHaveLength(1);
    expect(timeChanges[0]).toMatchObject({ measureIndex: 1 });
  });
});

describe("spans past the end of the score", () => {
  // Spotting the film before composing is the normal order of work, so a span
  // that sits beyond the written music is an ordinary state, not an error. It
  // used to emit a patch addressing a measure that does not exist, which threw
  // out of the Apply button's click handler.

  it("refuses to write a tempo where there is no bar, and says why", () => {
    const result = planPatches({
      score: emptyScore(4),
      plan: plan([{ meter: FOUR_FOUR, bars: 3 }]),
      startMeasureIndex: 4,
      currentBars: 1,
      bpm: 120,
      changeStructure: false,
    });
    expect(result.patches).toEqual([]);
    expect(result.warnings.join(" ")).toMatch(/past the end of the score/);
  });

  it("appends the bars, then writes the tempo onto them", () => {
    const result = planPatches({
      score: emptyScore(4),
      plan: plan([{ meter: FOUR_FOUR, bars: 3 }]),
      startMeasureIndex: 4,
      currentBars: 1,
      bpm: 120,
      changeStructure: true,
    });
    expect(result.insertedBars).toBe(3);
    // Order matters: the measure has to exist before a field can be set on it.
    expect(result.patches[0]).toMatchObject({ kind: "insertMeasures", atIndex: 4 });
    expect(result.patches[1]).toMatchObject({ kind: "setGlobalMeasureField", measureIndex: 4 });
  });

  it("never addresses a measure beyond the score", () => {
    const score = emptyScore(4);
    for (const start of [0, 3, 4, 9]) {
      for (const changeStructure of [false, true]) {
        const result = planPatches({
          score,
          plan: plan([{ meter: FOUR_FOUR, bars: 2 }]),
          startMeasureIndex: start,
          currentBars: 6,
          bpm: 120,
          changeStructure,
        });
        const inserted = result.insertedBars;
        for (const patch of result.patches) {
          if (patch.kind === "setGlobalMeasureField") {
            expect(patch.measureIndex).toBeLessThan(score.global.measures.length + inserted);
          }
          if (patch.kind === "removeMeasures") {
            expect(patch.startIndex + patch.count).toBeLessThanOrEqual(score.global.measures.length);
          }
        }
      }
    }
  });

  it("does not try to remove bars that are not there", () => {
    // `currentBars` comes from the timeline's own bar list, which can run past
    // the score when the tempo model is mid-rebuild.
    const result = planPatches({
      score: emptyScore(4),
      plan: plan([{ meter: FOUR_FOUR, bars: 1 }]),
      startMeasureIndex: 2,
      currentBars: 99,
      bpm: 120,
      changeStructure: true,
    });
    expect(result.removedBars).toBe(1);
    expect(result.patches).toContainEqual({ kind: "removeMeasures", startIndex: 3, count: 1 });
  });
});

describe("warning about damage", () => {
  it("stays quiet when the span is still empty", () => {
    // Planning ahead of the writing is the normal case; warning here would make
    // the warning meaningless when it matters.
    const result = planPatches({
      score: emptyScore(8),
      plan: plan([{ meter: THREE_FOUR, bars: 6 }]),
      startMeasureIndex: 0,
      currentBars: 4,
      bpm: 120,
      changeStructure: true,
    });
    expect(result.disturbedBars).toEqual([]);
  });

  it("names bars whose meter changes under written music", () => {
    const score = withMusicIn(emptyScore(8), 1);
    const result = planPatches({
      score,
      plan: plan([{ meter: THREE_FOUR, bars: 4 }]),
      startMeasureIndex: 0,
      currentBars: 4,
      bpm: 120,
      changeStructure: true,
    });
    expect(result.disturbedBars).toContain(1);
    expect(result.warnings.join(" ")).toMatch(/already contain music/);
  });

  it("names bars that would be removed outright", () => {
    const score = withMusicIn(emptyScore(8), 3);
    const result = planPatches({
      score,
      plan: plan([{ meter: FOUR_FOUR, bars: 2 }]),
      startMeasureIndex: 0,
      currentBars: 4,
      bpm: 120,
      changeStructure: true,
    });
    expect(result.disturbedBars).toContain(3);
  });

  it("does not count a bar of rests as damaged", () => {
    const score = emptyScore(8);
    const result = planPatches({
      score,
      plan: plan([{ meter: THREE_FOUR, bars: 2 }]),
      startMeasureIndex: 0,
      currentBars: 4,
      bpm: 120,
      changeStructure: true,
    });
    expect(result.disturbedBars).toEqual([]);
  });
});
