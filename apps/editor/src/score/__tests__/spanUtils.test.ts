import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { ensureMeasureId, ensureMeasureIdsInRange, resolveSpanFromSelection } from "../spanUtils";
import type { Selection } from "../../store/selectionStore";

/**
 * Build a score with `measureCount` measures, each containing 4 quarter-note events
 * (e0, e1, e2, e3). This allows tests to verify position-aware span resolution.
 */
function makeScore(measureCount = 3): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: Array.from({ length: measureCount }, (_, i) => ({
        ...(i === 0 ? { time: { count: 4, unit: 4 } } : {}),
      })),
    },
    parts: [
      {
        name: "Piano",
        measures: Array.from({ length: measureCount }, () => ({
          sequences: [
            {
              content: [
                {
                  type: "event" as const,
                  id: "e0",
                  duration: { base: "quarter" as const },
                  notes: [{ pitch: { step: "C", octave: 4 } }],
                },
                {
                  type: "event" as const,
                  id: "e1",
                  duration: { base: "quarter" as const },
                  notes: [{ pitch: { step: "D", octave: 4 } }],
                },
                {
                  type: "event" as const,
                  id: "e2",
                  duration: { base: "quarter" as const },
                  notes: [{ pitch: { step: "E", octave: 4 } }],
                },
                {
                  type: "event" as const,
                  id: "e3",
                  duration: { base: "quarter" as const },
                  notes: [{ pitch: { step: "F", octave: 4 } }],
                },
              ],
            },
          ],
        })),
      },
    ],
  };
}

function makeScoreWithIds(measureCount = 3): Score {
  const score = makeScore(measureCount);
  for (let i = 0; i < measureCount; i++) {
    score.global.measures[i]!.id = `m${i}`;
  }
  return score;
}

describe("ensureMeasureId", () => {
  it("returns existing ID when present", () => {
    const score = makeScoreWithIds();
    expect(ensureMeasureId(score, 0)).toBe("m0");
    expect(score.global.measures[0]!.id).toBe("m0");
  });

  it("generates ID when missing", () => {
    const score = makeScore();
    const id = ensureMeasureId(score, 1);
    expect(id).toBe("m1");
    expect(score.global.measures[1]!.id).toBe("m1");
  });

  it("avoids collisions with existing IDs", () => {
    const score = makeScore();
    score.global.measures[0]!.id = "m1"; // occupy "m1"
    const id = ensureMeasureId(score, 1);
    expect(id).not.toBe("m1"); // should not collide
    expect(id).toBe("m1_0");
  });

  it("throws for out-of-range index", () => {
    const score = makeScore(2);
    expect(() => ensureMeasureId(score, 5)).toThrow();
  });
});

describe("ensureMeasureIdsInRange", () => {
  it("assigns IDs to all measures in range", () => {
    const score = makeScore(4);
    ensureMeasureIdsInRange(score, 1, 3);
    expect(score.global.measures[0]!.id).toBeUndefined();
    expect(score.global.measures[1]!.id).toBeTruthy();
    expect(score.global.measures[2]!.id).toBeTruthy();
    expect(score.global.measures[3]!.id).toBeTruthy();
  });

  it("preserves existing IDs", () => {
    const score = makeScore(3);
    score.global.measures[1]!.id = "custom";
    ensureMeasureIdsInRange(score, 0, 2);
    expect(score.global.measures[1]!.id).toBe("custom");
  });
});

describe("resolveSpanFromSelection", () => {
  it("returns null for no selection", () => {
    const score = makeScore();
    const selection: Selection = { kind: "none" };
    const result = resolveSpanFromSelection(score, selection);
    expect(result).toBeNull();
  });

  it("starts at the selected event position for single selection", () => {
    const score = makeScore();
    // Select event e2 (3rd quarter note) → position = 2/4 = 1/2 whole note
    const selection: Selection = { kind: "single", elementId: "p0/m1/s0/e2", elementType: "event" };
    const result = resolveSpanFromSelection(score, selection);
    expect(result).not.toBeNull();
    expect(result!.startMeasureIndex).toBe(1);
    expect(result!.partIndex).toBe(0);
    expect(result!.startPosition).toEqual({ fraction: [1, 2] });
    expect(result!.endPosition.measure).toBe(score.global.measures[1]!.id);
    expect(result!.endPosition.position).toEqual({ fraction: [1, 1] });
  });

  it("starts at beat 0 for the first event in a measure", () => {
    const score = makeScore();
    const selection: Selection = { kind: "single", elementId: "p0/m0/s0/e0", elementType: "event" };
    const result = resolveSpanFromSelection(score, selection);
    expect(result).not.toBeNull();
    expect(result!.startPosition).toEqual({ fraction: [0, 1] });
  });

  it("assigns measure ID when missing for single selection", () => {
    const score = makeScore();
    expect(score.global.measures[2]!.id).toBeUndefined();
    const selection: Selection = { kind: "single", elementId: "p0/m2/s0/e0", elementType: "event" };
    resolveSpanFromSelection(score, selection);
    expect(score.global.measures[2]!.id).toBeTruthy();
  });

  it("resolves multi-measure span with precise positions from range selection", () => {
    const score = makeScoreWithIds(4);
    // Select from event e1 in measure 1 to event e2 in measure 3
    const selection: Selection = {
      kind: "range",
      startElementId: "p0/m1/s0/e1",
      endElementId: "p0/m3/s0/e2",
    };
    const result = resolveSpanFromSelection(score, selection);
    expect(result).not.toBeNull();
    expect(result!.startMeasureIndex).toBe(1);
    // Start at event e1 (2nd quarter note) → 1/4 whole note
    expect(result!.startPosition).toEqual({ fraction: [1, 4] });
    // End after event e2 (3rd quarter note) → 3/4 whole note
    expect(result!.endPosition.measure).toBe("m3");
    expect(result!.endPosition.position).toEqual({ fraction: [3, 4] });
  });

  it("orders measures correctly for reversed range", () => {
    const score = makeScoreWithIds(4);
    const selection: Selection = {
      kind: "range",
      startElementId: "p0/m3/s0/e0",
      endElementId: "p0/m1/s0/e0",
    };
    const result = resolveSpanFromSelection(score, selection);
    expect(result).not.toBeNull();
    // Should normalize to start=1, end=3
    expect(result!.startMeasureIndex).toBe(1);
    expect(result!.endPosition.measure).toBe("m3");
  });

  it("creates measure IDs for range when missing", () => {
    const score = makeScore(4);
    // No IDs on any measure
    const selection: Selection = {
      kind: "range",
      startElementId: "p0/m0/s0/e0",
      endElementId: "p0/m2/s0/e0",
    };
    const result = resolveSpanFromSelection(score, selection);
    expect(result).not.toBeNull();
    // All measures in range should now have IDs
    expect(score.global.measures[0]!.id).toBeTruthy();
    expect(score.global.measures[2]!.id).toBeTruthy();
    expect(result!.endPosition.measure).toBe(score.global.measures[2]!.id);
  });

  it("span across same measure with range gives precise start/end", () => {
    const score = makeScoreWithIds();
    // Select from event e1 to event e3 in the same measure
    const selection: Selection = {
      kind: "range",
      startElementId: "p0/m0/s0/e1",
      endElementId: "p0/m0/s0/e3",
    };
    const result = resolveSpanFromSelection(score, selection);
    expect(result).not.toBeNull();
    expect(result!.startMeasureIndex).toBe(0);
    // Start at e1 → 1/4
    expect(result!.startPosition).toEqual({ fraction: [1, 4] });
    // End after e3 → 4/4 = 1/1
    expect(result!.endPosition.measure).toBe("m0");
    expect(result!.endPosition.position).toEqual({ fraction: [1, 1] });
  });
});
