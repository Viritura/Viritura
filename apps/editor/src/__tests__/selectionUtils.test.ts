import { describe, it, expect } from "vitest";
import type { Score, NoteEvent } from "@viritura/core";
import type { Step, Octave } from "@viritura/core";
import {
  resolveSelectionMeasureRange,
  resolveRangeElementIds,
  selectAllRange,
  selectToEnd,
  selectToStart,
  groupEventsByVoice,
} from "../store/selectionUtils";
import { resolveEventFromSubElement } from "../score/ElementPath";
import { transposeNotes } from "../commands/transposeCommands";

// ═══════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════

function makeNote(id: string, base: "whole" | "half" | "quarter", step: Step = "C", octave: Octave = 4): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base },
    notes: [{ pitch: { step, octave } }],
  };
}

function makeMultiMeasureScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ id: "m0", time: { count: 4, unit: 4 } }, { id: "m1" }, { id: "m2" }, { id: "m3" }],
    },
    parts: [
      {
        name: "Violin",
        measures: [
          { sequences: [{ content: [makeNote("ev-m0", "whole")] }] },
          { sequences: [{ content: [makeNote("ev-m1", "whole", "D")] }] },
          { sequences: [{ content: [makeNote("ev-m2", "whole", "E")] }] },
          { sequences: [{ content: [makeNote("ev-m3", "whole", "F")] }] },
        ],
      },
      {
        name: "Cello",
        measures: [
          { sequences: [{ content: [makeNote("c-m0", "whole", "C", 3)] }] },
          { sequences: [{ content: [makeNote("c-m1", "whole", "D", 3)] }] },
          { sequences: [{ content: [makeNote("c-m2", "whole", "E", 3)] }] },
          { sequences: [{ content: [makeNote("c-m3", "whole", "F", 3)] }] },
        ],
      },
    ],
  };
}

// ═══════════════════════════════════════════
// resolveSelectionMeasureRange
// ═══════════════════════════════════════════

describe("resolveSelectionMeasureRange", () => {
  it("resolves range from two element IDs in same part", () => {
    const score = makeMultiMeasureScore();
    const range = resolveSelectionMeasureRange("p0/m1/s0/ev-m1", "p0/m3/s0/ev-m3", score);
    expect(range).toEqual({
      startMeasure: 1,
      endMeasure: 3,
      startPart: 0,
      endPart: 0,
      startVoice: 0,
      endVoice: 0,
    });
  });

  it("normalizes reversed order (end before start)", () => {
    const score = makeMultiMeasureScore();
    const range = resolveSelectionMeasureRange("p0/m3/s0/ev-m3", "p0/m0/s0/ev-m0", score);
    expect(range).not.toBeNull();
    expect(range!.startMeasure).toBe(0);
    expect(range!.endMeasure).toBe(3);
  });

  it("handles single measure (same measure for start and end)", () => {
    const score = makeMultiMeasureScore();
    const range = resolveSelectionMeasureRange("p0/m2/s0/ev-m2", "p0/m2/s0/ev-m2", score);
    expect(range).not.toBeNull();
    expect(range!.startMeasure).toBe(2);
    expect(range!.endMeasure).toBe(2);
  });

  it("handles cross-part range", () => {
    const score = makeMultiMeasureScore();
    const range = resolveSelectionMeasureRange("p0/m0/s0/ev-m0", "p1/m2/s0/c-m2", score);
    expect(range).not.toBeNull();
    expect(range!.startPart).toBe(0);
    expect(range!.endPart).toBe(1);
    expect(range!.startMeasure).toBe(0);
    expect(range!.endMeasure).toBe(2);
  });

  it("returns null for invalid element IDs", () => {
    const score = makeMultiMeasureScore();
    expect(resolveSelectionMeasureRange("invalid", "p0/m0/s0/ev-m0", score)).toBeNull();
    expect(resolveSelectionMeasureRange("p0/m0/s0/ev-m0", "invalid", score)).toBeNull();
  });
});

// ═══════════════════════════════════════════
// resolveRangeElementIds
// ═══════════════════════════════════════════

describe("resolveRangeElementIds", () => {
  it("returns all element IDs between start and end in navigation order", () => {
    const score = makeMultiMeasureScore();
    const ids = resolveRangeElementIds("p0/m1/s0/ev-m1", "p0/m2/s0/ev-m2", score);
    // Should include the precise range between start and end elements
    expect(ids).toContain("p0/m1/s0/ev-m1");
    expect(ids).toContain("p0/m2/s0/ev-m2");
    // Should NOT include elements outside the precise range
    expect(ids).not.toContain("p0/m0/s0/ev-m0");
    expect(ids).not.toContain("p0/m3/s0/ev-m3");
  });

  it("returns empty array for invalid element IDs", () => {
    const score = makeMultiMeasureScore();
    expect(resolveRangeElementIds("invalid", "p0/m0/s0/ev-m0", score)).toEqual([]);
  });

  // ── Regression: sub-element suffixes (notehead /n0, articulation /art0) ──

  it("strips notehead sub-element suffixes before resolving range", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [
                    makeNote("ev1", "quarter"),
                    makeNote("ev2", "quarter"),
                    makeNote("ev3", "quarter"),
                    makeNote("ev4", "quarter"),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    // Simulate hit-test returning notehead sub-IDs (smallest-area hit-test)
    const ids = resolveRangeElementIds("p0/m0/s0/ev2/n0", "p0/m0/s0/ev3/n0", score);
    // Should resolve to the parent events, not fall through to measure-level
    expect(ids).toContain("p0/m0/s0/ev2");
    expect(ids).toContain("p0/m0/s0/ev3");
    expect(ids).toHaveLength(2);
    // Should NOT include events outside the range
    expect(ids).not.toContain("p0/m0/s0/ev1");
    expect(ids).not.toContain("p0/m0/s0/ev4");
  });

  it("strips articulation sub-element suffixes before resolving range", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [makeNote("a", "quarter"), makeNote("b", "quarter"), makeNote("c", "half")],
                },
              ],
            },
          ],
        },
      ],
    };
    const ids = resolveRangeElementIds("p0/m0/s0/a/art0", "p0/m0/s0/b/ferm", score);
    expect(ids).toContain("p0/m0/s0/a");
    expect(ids).toContain("p0/m0/s0/b");
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain("p0/m0/s0/c");
  });

  // ── Regression: cross-voice contamination ──

  it("does not include events from other voices in same-voice range", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                // Voice 0: quarter notes
                {
                  content: [
                    makeNote("v0-e0", "quarter"),
                    makeNote("v0-e1", "quarter"),
                    makeNote("v0-e2", "quarter"),
                    makeNote("v0-e3", "quarter"),
                  ],
                },
                // Voice 1: quarter notes at same beat positions
                {
                  content: [
                    makeNote("v1-e0", "quarter", "E"),
                    makeNote("v1-e1", "quarter", "F"),
                    makeNote("v1-e2", "quarter", "G"),
                    makeNote("v1-e3", "quarter", "A"),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    // Select events in voice 0 only
    const ids = resolveRangeElementIds("p0/m0/s0/v0-e1", "p0/m0/s0/v0-e3", score);
    // Should contain only voice 0 events in the range
    expect(ids).toContain("p0/m0/s0/v0-e1");
    expect(ids).toContain("p0/m0/s0/v0-e2");
    expect(ids).toContain("p0/m0/s0/v0-e3");
    expect(ids).toHaveLength(3);
    // Should NOT contain any voice 1 events
    expect(ids).not.toContain("p0/m0/s1/v1-e0");
    expect(ids).not.toContain("p0/m0/s1/v1-e1");
    expect(ids).not.toContain("p0/m0/s1/v1-e2");
    expect(ids).not.toContain("p0/m0/s1/v1-e3");
  });

  // ── Regression: range selection includes measure-level annotations ──

  it("includes dynamics between note range endpoints", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              dynamics: [{ id: "0", value: "f", position: { fraction: [1, 4] as [number, number] } }],
              sequences: [
                {
                  content: [
                    makeNote("e0", "quarter"),
                    makeNote("e1", "quarter"),
                    makeNote("e2", "quarter"),
                    makeNote("e3", "quarter"),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const ids = resolveRangeElementIds("p0/m0/s0/e0", "p0/m0/s0/e2", score);
    // Notes and directions share one contiguous range.
    expect(ids).toContain("p0/m0/s0/e0");
    expect(ids).toContain("p0/m0/s0/e1");
    expect(ids).toContain("p0/m0/s0/e2");
    expect(ids).toContain("p0/m0/dyn0");
    expect(ids).toHaveLength(4);

    const noteToDynamic = resolveRangeElementIds("p0/m0/s0/e0", "p0/m0/dyn0", score);
    expect(noteToDynamic).toEqual(["p0/m0/s0/e0", "p0/m0/s0/e1", "p0/m0/dyn0"]);
  });

  it("includes intervening notes when the end of a same-part range is a dynamic", () => {
    const score = makeMultiMeasureScore();
    score.parts[0]!.measures[2]!.dynamics = [
      {
        id: "dyn-end",
        type: "immediate",
        position: { fraction: [0, 1] },
        value: "f",
      },
    ];

    const ids = resolveRangeElementIds("p0/m0/s0/ev-m0", "p0/m2/dyndyn-end", score);
    expect(ids).toEqual(["p0/m0/s0/ev-m0", "p0/m1/s0/ev-m1", "p0/m2/s0/ev-m2", "p0/m2/dyndyn-end"]);
  });

  it("includes both opposing corners of a same-staff note-to-dynamic range", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              dynamics: [0, 1, 2].map((beat) => ({
                id: `dyn-${beat}`,
                type: "immediate" as const,
                position: { fraction: [beat, 4] as [number, number] },
                value: "sf",
              })),
              sequences: [
                {
                  content: [
                    makeNote("e0", "quarter"),
                    makeNote("e1", "quarter"),
                    makeNote("e2", "quarter"),
                    makeNote("e3", "quarter"),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const ids = resolveRangeElementIds("p0/m0/s0/e0", "p0/m0/dyndyn-2", score);
    expect(ids).toEqual(
      expect.arrayContaining([
        "p0/m0/s0/e0",
        "p0/m0/dyndyn-0",
        "p0/m0/s0/e1",
        "p0/m0/dyndyn-1",
        "p0/m0/s0/e2",
        "p0/m0/dyndyn-2",
      ]),
    );
    expect(ids).toHaveLength(6);
  });
});

// ═══════════════════════════════════════════
// selectAllRange
// ═══════════════════════════════════════════

describe("selectAllRange", () => {
  it("returns first and last element IDs for the whole score", () => {
    const score = makeMultiMeasureScore();
    const result = selectAllRange(score);
    expect(result).not.toBeNull();
    expect(result!.startElementId).toBe("p0/m0/s0/ev-m0");
    expect(result!.endElementId).toBe("p1/m3/s0/c-m3");
  });

  it("returns null for a score with a single event", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          measures: [{ sequences: [{ content: [makeNote("only", "whole")] }] }],
        },
      ],
    };
    expect(selectAllRange(score)).toBeNull();
  });

  it("returns null for empty score", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [] },
      parts: [],
    };
    expect(selectAllRange(score)).toBeNull();
  });
});

// ═══════════════════════════════════════════
// selectToEnd / selectToStart
// ═══════════════════════════════════════════

describe("selectToEnd", () => {
  it("returns last element ID", () => {
    const score = makeMultiMeasureScore();
    const result = selectToEnd("p0/m1/s0/ev-m1", score);
    expect(result).toBe("p1/m3/s0/c-m3");
  });

  it("returns null when already at end", () => {
    const score = makeMultiMeasureScore();
    expect(selectToEnd("p1/m3/s0/c-m3", score)).toBeNull();
  });
});

describe("selectToStart", () => {
  it("returns first element ID", () => {
    const score = makeMultiMeasureScore();
    const result = selectToStart("p0/m1/s0/ev-m1", score);
    expect(result).toBe("p0/m0/s0/ev-m0");
  });

  it("returns null when already at start", () => {
    const score = makeMultiMeasureScore();
    expect(selectToStart("p0/m0/s0/ev-m0", score)).toBeNull();
  });
});

// ═══════════════════════════════════════════
// Regression: range transpose precision
// ═══════════════════════════════════════════

describe("range selection → transpose integration", () => {
  it("transposing a sub-range only affects selected events, not the whole measure", () => {
    // Measure with 4 quarter notes: C4, D4, E4, F4
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [
                    makeNote("n1", "quarter", "C", 4),
                    makeNote("n2", "quarter", "D", 4),
                    makeNote("n3", "quarter", "E", 4),
                    makeNote("n4", "quarter", "F", 4),
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    // Select only notes 2 and 3 (D4, E4) via range
    const selectedIds = resolveRangeElementIds("p0/m0/s0/n2", "p0/m0/s0/n3", score);

    // Resolve to event locations (same pipeline as useEditorKeyboard)
    const locations = selectedIds
      .map((id) => resolveEventFromSubElement(id, score))
      .filter((loc): loc is NonNullable<typeof loc> => loc !== null);

    expect(locations).toHaveLength(2);

    // Transpose selected notes up by 1 chromatic half step
    const result = transposeNotes(score, locations, "chromatic", 1);

    // Notes 2 and 3 should be transposed (D#4, F4)
    const seq = result.parts[0]!.measures[0]!.sequences[0]!;
    const n2 = seq.content[1] as NoteEvent;
    const n3 = seq.content[2] as NoteEvent;
    // D4 + 1 half step → D#4 (step stays D, alter becomes 1)
    expect(n2.notes![0]!.pitch.alter).toBe(1);
    // E4 + 1 half step → F4 (step becomes F, no alter)
    expect(n3.notes![0]!.pitch.step).toBe("F");
    expect(n3.notes![0]!.pitch.alter).toBeUndefined();

    // Notes 1 and 4 should be UNCHANGED
    const n1 = seq.content[0] as NoteEvent;
    const n4 = seq.content[3] as NoteEvent;
    expect(n1.notes![0]!.pitch.step).toBe("C");
    expect(n1.notes![0]!.pitch.octave).toBe(4);
    expect(n4.notes![0]!.pitch.step).toBe("F");
    expect(n4.notes![0]!.pitch.octave).toBe(4);
  });

  it("transposing full measure range affects all events", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [makeNote("a", "quarter", "C", 4), makeNote("b", "quarter", "D", 4)],
                },
              ],
            },
          ],
        },
      ],
    };

    // Select all events in the measure
    const selectedIds = resolveRangeElementIds("p0/m0/s0/a", "p0/m0/s0/b", score);
    const locations = selectedIds
      .map((id) => resolveEventFromSubElement(id, score))
      .filter((loc): loc is NonNullable<typeof loc> => loc !== null);

    expect(locations).toHaveLength(2);

    // Transpose up an octave
    const result = transposeNotes(score, locations, "chromatic", 12);
    const seq = result.parts[0]!.measures[0]!.sequences[0]!;
    expect((seq.content[0] as NoteEvent).notes![0]!.pitch.octave).toBe(5);
    expect((seq.content[1] as NoteEvent).notes![0]!.pitch.octave).toBe(5);
  });
});

// ═══════════════════════════════════════════
// Cross-staff selection (regression tests)
// ═══════════════════════════════════════════

describe("resolveRangeElementIds — cross-staff", () => {
  it("includes events from multiple parts when start and end are in different parts", () => {
    const score = makeMultiMeasureScore();
    // Select from part 0 measure 1 to part 1 measure 2
    const ids = resolveRangeElementIds("p0/m1/s0/ev-m1", "p1/m2/s0/c-m2", score);
    // Should include events from BOTH parts in the range
    expect(ids).toContain("p0/m1/s0/ev-m1");
    expect(ids).toContain("p0/m2/s0/ev-m2");
    expect(ids).toContain("p1/m1/s0/c-m1");
    expect(ids).toContain("p1/m2/s0/c-m2");
    // Should NOT include events outside the measure range
    expect(ids).not.toContain("p0/m0/s0/ev-m0");
    expect(ids).not.toContain("p1/m0/s0/c-m0");
    expect(ids).not.toContain("p0/m3/s0/ev-m3");
    expect(ids).not.toContain("p1/m3/s0/c-m3");
  });

  it("handles reversed order (end part before start part)", () => {
    const score = makeMultiMeasureScore();
    // Select from part 1 to part 0 (reversed)
    const ids = resolveRangeElementIds("p1/m1/s0/c-m1", "p0/m2/s0/ev-m2", score);
    expect(ids).toContain("p0/m1/s0/ev-m1");
    expect(ids).toContain("p0/m2/s0/ev-m2");
    expect(ids).toContain("p1/m1/s0/c-m1");
    expect(ids).toContain("p1/m2/s0/c-m2");
  });

  it("handles same measure, different parts", () => {
    const score = makeMultiMeasureScore();
    const ids = resolveRangeElementIds("p0/m1/s0/ev-m1", "p1/m1/s0/c-m1", score);
    expect(ids).toContain("p0/m1/s0/ev-m1");
    expect(ids).toContain("p1/m1/s0/c-m1");
    expect(ids).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════
// Beat-position-aware selection (regression tests)
// ═══════════════════════════════════════════

describe("resolveRangeElementIds — beat-position filtering", () => {
  /** Score with multiple quarter notes per measure, 2 parts. */
  function makeDetailedScore(): Score {
    return {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }, {}],
      },
      parts: [
        {
          name: "Flute",
          measures: [
            {
              sequences: [
                {
                  content: [
                    makeNote("f-m0-e0", "quarter", "C", 5),
                    makeNote("f-m0-e1", "quarter", "D", 5),
                    makeNote("f-m0-e2", "quarter", "E", 5),
                    makeNote("f-m0-e3", "quarter", "F", 5),
                  ],
                },
              ],
            },
            {
              sequences: [
                {
                  content: [
                    makeNote("f-m1-e0", "quarter", "G", 5),
                    makeNote("f-m1-e1", "quarter", "A", 5),
                    makeNote("f-m1-e2", "quarter", "B", 5),
                    makeNote("f-m1-e3", "quarter", "C", 6),
                  ],
                },
              ],
            },
          ],
        },
        {
          name: "Cello",
          measures: [
            {
              sequences: [
                {
                  content: [makeNote("c-m0-e0", "whole", "C", 3)],
                },
              ],
            },
            {
              sequences: [
                {
                  content: [makeNote("c-m1-e0", "half", "D", 3), makeNote("c-m1-e1", "half", "E", 3)],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  it("excludes events in other staves that start before the selection start beat", () => {
    const score = makeDetailedScore();
    // Select from flute beat 2 (e2 at beat 2) to cello m1 e1 (beat 2)
    // Cello m0 has a whole note starting at beat 0 — should be EXCLUDED
    // because its start beat (0) < start beat (2)
    const ids = resolveRangeElementIds(
      "p0/m0/s0/f-m0-e2", // beat 2 in measure 0
      "p1/m1/s0/c-m1-e1", // beat 2 in measure 1
      score,
    );
    // Flute m0: only e2 (beat 2) and e3 (beat 3) should be included
    expect(ids).toContain("p0/m0/s0/f-m0-e2");
    expect(ids).toContain("p0/m0/s0/f-m0-e3");
    expect(ids).not.toContain("p0/m0/s0/f-m0-e0");
    expect(ids).not.toContain("p0/m0/s0/f-m0-e1");

    // Cello m0: whole note at beat 0 should be excluded (starts before beat 2)
    expect(ids).not.toContain("p0/m0/s0/c-m0-e0");

    // Flute m1: only events up to and including the end beat (beat 2)
    expect(ids).toContain("p0/m1/s0/f-m1-e0");
    expect(ids).toContain("p0/m1/s0/f-m1-e1");
    expect(ids).toContain("p0/m1/s0/f-m1-e2");
    // f-m1-e3 is at beat 3, which is AFTER the end element (beat 2), so excluded
    expect(ids).not.toContain("p0/m1/s0/f-m1-e3");

    // Cello m1: e0 (beat 0) and e1 (beat 2) — e1 at end beat should be included
    expect(ids).toContain("p1/m1/s0/c-m1-e0");
    expect(ids).toContain("p1/m1/s0/c-m1-e1");
  });

  it("excludes events in other staves that start after the selection end beat", () => {
    const score = makeDetailedScore();
    // Select from cello m0 (beat 0) to flute m0 e1 (beat 1)
    const ids = resolveRangeElementIds(
      "p1/m0/s0/c-m0-e0", // beat 0 in measure 0
      "p0/m0/s0/f-m0-e1", // beat 1 in measure 0
      score,
    );
    // Flute m0: only e0 (beat 0) and e1 (beat 1) should be included
    expect(ids).toContain("p0/m0/s0/f-m0-e0");
    expect(ids).toContain("p0/m0/s0/f-m0-e1");
    // e2 and e3 start after beat 1
    expect(ids).not.toContain("p0/m0/s0/f-m0-e2");
    expect(ids).not.toContain("p0/m0/s0/f-m0-e3");

    // Cello m0: whole note at beat 0, within range
    expect(ids).toContain("p1/m0/s0/c-m0-e0");
  });
});

// ═══════════════════════════════════════════
// resolveSelectionMeasureRange with sub-element IDs
// ═══════════════════════════════════════════

describe("resolveSelectionMeasureRange — sub-element IDs", () => {
  it("resolves notehead sub-element IDs correctly", () => {
    const score = makeMultiMeasureScore();
    const range = resolveSelectionMeasureRange("p0/m1/s0/ev-m1/n0", "p0/m2/s0/ev-m2/n0", score);
    expect(range).not.toBeNull();
    expect(range!.startMeasure).toBe(1);
    expect(range!.endMeasure).toBe(2);
  });

  it("resolves cross-part range with notehead sub-element IDs", () => {
    const score = makeMultiMeasureScore();
    const range = resolveSelectionMeasureRange("p0/m0/s0/ev-m0/n0", "p1/m2/s0/c-m2/n0", score);
    expect(range).not.toBeNull();
    expect(range!.startPart).toBe(0);
    expect(range!.endPart).toBe(1);
    expect(range!.startMeasure).toBe(0);
    expect(range!.endMeasure).toBe(2);
  });

  it("resolves articulation sub-element IDs correctly", () => {
    const score = makeMultiMeasureScore();
    const range = resolveSelectionMeasureRange("p0/m0/s0/ev-m0/art0", "p0/m3/s0/ev-m3/ferm", score);
    expect(range).not.toBeNull();
    expect(range!.startMeasure).toBe(0);
    expect(range!.endMeasure).toBe(3);
  });
});

// ═══════════════════════════════════════════
// groupEventsByVoice
// ═══════════════════════════════════════════

describe("groupEventsByVoice", () => {
  const at = (partIndex: number, sequenceIndex: number, eventIndex: number) => ({
    partIndex,
    measureIndex: 0,
    sequenceIndex,
    eventIndex,
  });

  it("returns an empty array for no events", () => {
    expect(groupEventsByVoice([])).toEqual([]);
  });

  it("keeps a single voice's events in one group, in order", () => {
    const events = [at(0, 0, 0), at(0, 0, 1), at(0, 0, 2)];
    const groups = groupEventsByVoice(events);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((e) => e.eventIndex)).toEqual([0, 1, 2]);
  });

  it("splits events across parts into one group per part", () => {
    const events = [at(0, 0, 0), at(1, 0, 0), at(0, 0, 1), at(1, 0, 1)];
    const groups = groupEventsByVoice(events);
    expect(groups).toHaveLength(2);
    const part0 = groups.find((g) => g[0]!.partIndex === 0)!;
    const part1 = groups.find((g) => g[0]!.partIndex === 1)!;
    expect(part0.map((e) => e.eventIndex)).toEqual([0, 1]);
    expect(part1.map((e) => e.eventIndex)).toEqual([0, 1]);
  });

  it("splits events across voices (sequences) within one part", () => {
    const events = [at(0, 0, 0), at(0, 1, 0), at(0, 0, 1)];
    const groups = groupEventsByVoice(events);
    expect(groups).toHaveLength(2);
    const voice0 = groups.find((g) => g[0]!.sequenceIndex === 0)!;
    const voice1 = groups.find((g) => g[0]!.sequenceIndex === 1)!;
    expect(voice0.map((e) => e.eventIndex)).toEqual([0, 1]);
    expect(voice1.map((e) => e.eventIndex)).toEqual([0]);
  });
});
