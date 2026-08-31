import { describe, it, expect } from "vitest";
import type { Score, NoteEvent } from "@viritura/core";
import { isRest } from "@viritura/core";
import type { Step, Octave } from "@viritura/core";
import { analyzeBeatCounts, analyzeBeatCountsInRange, repairBeatCounts } from "../commands/measureValidation";
import { sequenceContentBeats } from "../commands/noteCommands";

// ═══════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════

function makeNote(
  id: string,
  base: "whole" | "half" | "quarter" | "eighth",
  step: Step = "C",
  octave: Octave = 4,
): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base },
    notes: [{ pitch: { step, octave } }],
  };
}

function _makeRest(id: string, base: "whole" | "half" | "quarter" | "eighth"): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base },
    rest: {},
  };
}

/** Helper: compute total beats in a sequence content array. */
function totalBeats(content: NoteEvent[]): number {
  return content.reduce((sum, ev) => sum + sequenceContentBeats(ev), 0);
}

/** Create a correct 4/4 score with the given number of measures and parts. */
function makeScore(
  measureCount: number,
  partCount: number = 1,
  eventsPerMeasure: NoteEvent[] = [makeNote("e", "whole")],
): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: Array.from({ length: measureCount }, (_, i) => (i === 0 ? { time: { count: 4, unit: 4 } } : {})),
    },
    parts: Array.from({ length: partCount }, (_, p) => ({
      name: `Part ${p}`,
      measures: Array.from({ length: measureCount }, () => ({
        sequences: [
          {
            content: eventsPerMeasure.map((ev) => ({
              ...ev,
              id: `${ev.id}-${Math.random().toString(36).slice(2, 6)}`,
            })),
          },
        ],
      })),
    })),
  };
}

// ═══════════════════════════════════════════
// analyzeBeatCounts
// ═══════════════════════════════════════════

describe("analyzeBeatCounts", () => {
  it("returns empty array for a correct score", () => {
    const score = makeScore(4);
    expect(analyzeBeatCounts(score)).toEqual([]);
  });

  it("detects an underfull measure", () => {
    const score = makeScore(2);
    // Replace measure 1 with only a half note (2 beats instead of 4)
    score.parts[0]!.measures[1]!.sequences[0]!.content = [makeNote("x", "half")];
    const issues = analyzeBeatCounts(score);
    expect(issues.length).toBe(1);
    expect(issues[0]!.measureIndex).toBe(1);
    expect(issues[0]!.difference).toBeCloseTo(-2);
  });

  it("detects an overfull measure", () => {
    const score = makeScore(2);
    // Add an extra quarter to measure 0 (5 beats instead of 4)
    score.parts[0]!.measures[0]!.sequences[0]!.content = [makeNote("a", "whole"), makeNote("b", "quarter")];
    const issues = analyzeBeatCounts(score);
    expect(issues.length).toBe(1);
    expect(issues[0]!.measureIndex).toBe(0);
    expect(issues[0]!.difference).toBeCloseTo(1);
  });

  it("detects issues in multiple parts", () => {
    const score = makeScore(1, 2);
    // Make both parts underfull
    score.parts[0]!.measures[0]!.sequences[0]!.content = [makeNote("a", "half")];
    score.parts[1]!.measures[0]!.sequences[0]!.content = [makeNote("b", "quarter")];
    const issues = analyzeBeatCounts(score);
    expect(issues.length).toBe(2);
    expect(issues[0]!.partIndex).toBe(0);
    expect(issues[1]!.partIndex).toBe(1);
  });

  it("handles time signature changes", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }, { time: { count: 3, unit: 4 } }],
      },
      parts: [
        {
          name: "Piano",
          measures: [
            { sequences: [{ content: [makeNote("a", "whole")] }] }, // 4/4: 4 beats ✓
            { sequences: [{ content: [makeNote("b", "whole")] }] }, // 3/4: 4 beats ✗ (overfull)
          ],
        },
      ],
    };
    const issues = analyzeBeatCounts(score);
    expect(issues.length).toBe(1);
    expect(issues[0]!.measureIndex).toBe(1);
    expect(issues[0]!.difference).toBeCloseTo(1); // 4 - 3 = 1 beat overfull
  });

  it("skips fullMeasure sequences", () => {
    const score = makeScore(1);
    score.parts[0]!.measures[0]!.sequences[0]!.fullMeasure = { visualDuration: { base: "whole" } };
    expect(analyzeBeatCounts(score)).toEqual([]);
  });

  it("allows arbitrary content in a declared senza misura measure", () => {
    const score = makeScore(3);
    score.global.measures = [
      { time: { count: 2, unit: 4 } },
      { time: { count: 2, unit: 4, display: "senzaMisura" } },
      {},
    ];
    score.parts[0]!.measures[0]!.sequences[0]!.content = [makeNote("before", "half")];
    score.parts[0]!.measures[1]!.sequences[0]!.content = [
      makeNote("c1", "quarter"),
      makeNote("c2", "quarter"),
      makeNote("c3", "half"),
      makeNote("c4", "quarter"),
      makeNote("c5", "quarter"),
      makeNote("c6", "quarter"),
    ];
    score.parts[0]!.measures[2]!.sequences[0]!.content = [makeNote("after", "quarter")];

    const issues = analyzeBeatCounts(score);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ measureIndex: 2, expectedBeats: 2, actualBeats: 1 });
  });
});

// ═══════════════════════════════════════════
// analyzeBeatCountsInRange
// ═══════════════════════════════════════════

describe("analyzeBeatCountsInRange", () => {
  it("only checks measures within the range", () => {
    const score = makeScore(4);
    // Make measures 1 and 3 underfull
    score.parts[0]!.measures[1]!.sequences[0]!.content = [makeNote("a", "half")];
    score.parts[0]!.measures[3]!.sequences[0]!.content = [makeNote("b", "quarter")];

    // Range [1, 1] should find only measure 1
    const issues1 = analyzeBeatCountsInRange(score, 1, 1);
    expect(issues1.length).toBe(1);
    expect(issues1[0]!.measureIndex).toBe(1);

    // Range [3, 3] should find only measure 3
    const issues3 = analyzeBeatCountsInRange(score, 3, 3);
    expect(issues3.length).toBe(1);
    expect(issues3[0]!.measureIndex).toBe(3);

    // Range [0, 0] should find nothing (measure 0 is correct)
    const issues0 = analyzeBeatCountsInRange(score, 0, 0);
    expect(issues0.length).toBe(0);
  });

  it("handles range spanning multiple measures", () => {
    const score = makeScore(4);
    score.parts[0]!.measures[1]!.sequences[0]!.content = [makeNote("a", "half")];
    score.parts[0]!.measures[2]!.sequences[0]!.content = [makeNote("b", "quarter")];

    const issues = analyzeBeatCountsInRange(score, 1, 2);
    expect(issues.length).toBe(2);
  });

  it("resolves time signature from before the range", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 3, unit: 4 } }, {}, {}],
      },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [{ content: [makeNote("a", "quarter"), makeNote("b", "quarter"), makeNote("c", "quarter")] }],
            },
            { sequences: [{ content: [makeNote("d", "whole")] }] }, // 4 beats in 3/4 = overfull
            {
              sequences: [{ content: [makeNote("e", "quarter"), makeNote("f", "quarter"), makeNote("g", "quarter")] }],
            },
          ],
        },
      ],
    };

    // Only check measure 1 — should know it's 3/4 from measure 0
    const issues = analyzeBeatCountsInRange(score, 1, 1);
    expect(issues.length).toBe(1);
    expect(issues[0]!.difference).toBeCloseTo(1); // 4 - 3 = overfull by 1
  });

  it("returns same results as analyzeBeatCounts for full range", () => {
    const score = makeScore(4, 2);
    score.parts[0]!.measures[1]!.sequences[0]!.content = [makeNote("a", "half")];
    score.parts[1]!.measures[3]!.sequences[0]!.content = [makeNote("b", "quarter")];

    const fullIssues = analyzeBeatCounts(score);
    const rangeIssues = analyzeBeatCountsInRange(score, 0, 3);

    expect(rangeIssues.length).toBe(fullIssues.length);
    for (let i = 0; i < fullIssues.length; i++) {
      expect(rangeIssues[i]!.measureIndex).toBe(fullIssues[i]!.measureIndex);
      expect(rangeIssues[i]!.partIndex).toBe(fullIssues[i]!.partIndex);
      expect(rangeIssues[i]!.difference).toBeCloseTo(fullIssues[i]!.difference);
    }
  });

  it("handles out-of-range measure indices gracefully", () => {
    const score = makeScore(2);
    expect(analyzeBeatCountsInRange(score, 5, 10)).toEqual([]);
    expect(analyzeBeatCountsInRange(score, 0, 100).length).toBe(0); // all measures are correct
  });
});

// ═══════════════════════════════════════════
// repairBeatCounts — full scan
// ═══════════════════════════════════════════

describe("repairBeatCounts (full scan)", () => {
  it("pads underfull measures with rests", () => {
    const score = makeScore(1);
    score.parts[0]!.measures[0]!.sequences[0]!.content = [makeNote("a", "half")]; // 2 beats

    const repaired = repairBeatCounts(score);
    expect(repaired).toBe(1);

    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(totalBeats(content)).toBeCloseTo(4);
    // First event is still the half note
    expect(content[0]!.notes?.[0]?.pitch.step).toBe("C");
    // Rest fills the remaining 2 beats
    expect(content.some((ev) => isRest(ev))).toBe(true);
  });

  it("truncates overfull measures", () => {
    const score = makeScore(1);
    score.parts[0]!.measures[0]!.sequences[0]!.content = [makeNote("a", "whole"), makeNote("b", "half")]; // 6 beats

    const repaired = repairBeatCounts(score);
    expect(repaired).toBe(1);

    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(totalBeats(content)).toBeCloseTo(4);
  });

  it("returns 0 for a correct score", () => {
    const score = makeScore(4, 2);
    expect(repairBeatCounts(score)).toBe(0);
  });

  it("repairs multiple parts and measures", () => {
    const score = makeScore(3, 2);
    // Part 0 measure 1: underfull
    score.parts[0]!.measures[1]!.sequences[0]!.content = [makeNote("a", "quarter")];
    // Part 1 measure 2: overfull
    score.parts[1]!.measures[2]!.sequences[0]!.content = [makeNote("b", "whole"), makeNote("c", "whole")];

    const repaired = repairBeatCounts(score);
    expect(repaired).toBe(2);

    expect(totalBeats(score.parts[0]!.measures[1]!.sequences[0]!.content)).toBeCloseTo(4);
    expect(totalBeats(score.parts[1]!.measures[2]!.sequences[0]!.content)).toBeCloseTo(4);
  });

  it("does not mutate correct measures", () => {
    const score = makeScore(2);
    score.parts[0]!.measures[1]!.sequences[0]!.content = [makeNote("a", "half")]; // underfull

    const m0Before = JSON.stringify(score.parts[0]!.measures[0]!);
    repairBeatCounts(score);
    const m0After = JSON.stringify(score.parts[0]!.measures[0]!);

    expect(m0After).toBe(m0Before); // Measure 0 untouched
  });

  it("preserves short pickup (anacrusis) measure 0 when number === 0", () => {
    // Viritura convention: measure[0].number === 0 marks an anacrusis.
    // Underfull content must not be padded with rests — matches Rust
    // reconcile_score behavior.
    const score = makeScore(2);
    score.global.measures[0]!.number = 0;
    score.parts[0]!.measures[0]!.sequences[0]!.content = [makeNote("a", "quarter")]; // 1 beat in 4/4

    const issues = analyzeBeatCounts(score);
    expect(issues.find((i) => i.measureIndex === 0)).toBeUndefined();

    const repaired = repairBeatCounts(score);
    expect(repaired).toBe(0);

    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content).toHaveLength(1);
    expect(totalBeats(content)).toBeCloseTo(1);
    expect(content.some((ev) => isRest(ev))).toBe(false);
  });

  it("still flags overfull pickup measure", () => {
    // A pickup with MORE than measure_beats is still wrong.
    const score = makeScore(2);
    score.global.measures[0]!.number = 0;
    score.parts[0]!.measures[0]!.sequences[0]!.content = [makeNote("a", "whole"), makeNote("b", "half")]; // 6 beats — overfull

    const repaired = repairBeatCounts(score);
    expect(repaired).toBe(1);
    expect(totalBeats(score.parts[0]!.measures[0]!.sequences[0]!.content)).toBeCloseTo(4);
  });

  it("does not truncate a declared senza misura measure", () => {
    const score = makeScore(2);
    score.global.measures = [{ time: { count: 2, unit: 4 } }, { time: { count: 2, unit: 4, display: "senzaMisura" } }];
    score.parts[0]!.measures[0]!.sequences[0]!.content = [makeNote("before", "half")];
    score.parts[0]!.measures[1]!.sequences[0]!.content = [
      makeNote("c1", "quarter"),
      makeNote("c2", "quarter"),
      makeNote("c3", "half"),
      makeNote("c4", "quarter"),
      makeNote("c5", "quarter"),
      makeNote("c6", "quarter"),
    ];
    const before = JSON.stringify(score.parts[0]!.measures[1]!.sequences[0]!.content);

    expect(repairBeatCounts(score, { start: 1, end: 1 })).toBe(0);
    expect(JSON.stringify(score.parts[0]!.measures[1]!.sequences[0]!.content)).toBe(before);
  });
});

// ═══════════════════════════════════════════
// repairBeatCounts — targeted range
// ═══════════════════════════════════════════

describe("repairBeatCounts (targeted range)", () => {
  it("only repairs measures within the specified range", () => {
    const score = makeScore(4);
    // Make measures 1 and 3 underfull
    score.parts[0]!.measures[1]!.sequences[0]!.content = [makeNote("a", "half")];
    score.parts[0]!.measures[3]!.sequences[0]!.content = [makeNote("b", "quarter")];

    // Only repair measure 1
    const repaired = repairBeatCounts(score, { start: 1, end: 1 });
    expect(repaired).toBe(1);

    // Measure 1 should be fixed
    expect(totalBeats(score.parts[0]!.measures[1]!.sequences[0]!.content)).toBeCloseTo(4);

    // Measure 3 should still be broken
    expect(totalBeats(score.parts[0]!.measures[3]!.sequences[0]!.content)).toBeCloseTo(1);
  });

  it("repairs a range of measures", () => {
    const score = makeScore(4);
    score.parts[0]!.measures[1]!.sequences[0]!.content = [makeNote("a", "half")];
    score.parts[0]!.measures[2]!.sequences[0]!.content = [makeNote("b", "whole"), makeNote("c", "quarter")];

    const repaired = repairBeatCounts(score, { start: 1, end: 2 });
    expect(repaired).toBe(2);

    expect(totalBeats(score.parts[0]!.measures[1]!.sequences[0]!.content)).toBeCloseTo(4);
    expect(totalBeats(score.parts[0]!.measures[2]!.sequences[0]!.content)).toBeCloseTo(4);
  });

  it("has same result as full scan when range covers all measures", () => {
    const score1 = makeScore(3);
    score1.parts[0]!.measures[0]!.sequences[0]!.content = [makeNote("a", "half")];
    score1.parts[0]!.measures[2]!.sequences[0]!.content = [makeNote("b", "whole"), makeNote("c", "whole")];

    const score2 = JSON.parse(JSON.stringify(score1)) as Score;

    repairBeatCounts(score1); // full scan
    repairBeatCounts(score2, { start: 0, end: 2 }); // targeted, full range

    // Both should produce the same beat counts
    for (let m = 0; m < 3; m++) {
      expect(totalBeats(score1.parts[0]!.measures[m]!.sequences[0]!.content)).toBeCloseTo(
        totalBeats(score2.parts[0]!.measures[m]!.sequences[0]!.content),
      );
    }
  });

  it("handles empty range gracefully", () => {
    const score = makeScore(2);
    score.parts[0]!.measures[0]!.sequences[0]!.content = [makeNote("a", "half")];

    // Range outside score
    const repaired = repairBeatCounts(score, { start: 10, end: 20 });
    expect(repaired).toBe(0);

    // Measure 0 still broken
    expect(totalBeats(score.parts[0]!.measures[0]!.sequences[0]!.content)).toBeCloseTo(2);
  });

  it("repairs across multiple parts in the range", () => {
    const score = makeScore(2, 3);
    // All 3 parts have issues in measure 1
    score.parts[0]!.measures[1]!.sequences[0]!.content = [makeNote("a", "half")];
    score.parts[1]!.measures[1]!.sequences[0]!.content = [makeNote("b", "quarter")];
    score.parts[2]!.measures[1]!.sequences[0]!.content = [makeNote("c", "whole"), makeNote("d", "whole")];

    const repaired = repairBeatCounts(score, { start: 1, end: 1 });
    expect(repaired).toBe(3);

    expect(totalBeats(score.parts[0]!.measures[1]!.sequences[0]!.content)).toBeCloseTo(4);
    expect(totalBeats(score.parts[1]!.measures[1]!.sequences[0]!.content)).toBeCloseTo(4);
    expect(totalBeats(score.parts[2]!.measures[1]!.sequences[0]!.content)).toBeCloseTo(4);
  });
});
