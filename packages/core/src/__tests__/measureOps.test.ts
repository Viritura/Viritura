import { describe, it, expect } from "vitest";
import type { Score } from "../model/score";
import {
  appendMeasure,
  insertMeasure,
  deleteMeasure,
  setTimeSignature,
  setKeySignature,
  setRepeatStart,
  setMeasureRepeat,
  setBarline,
  setRepeatEnd,
  setClef,
  setEnding,
} from "../operations";

/** Helper: minimal 2-measure score with one part */
function twoMeasureScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }, { barline: { type: "final" } }],
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
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                ],
              },
            ],
          },
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    duration: { base: "whole" },
                    rest: {},
                  },
                ],
                fullMeasure: { visualDuration: { base: "whole" } },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Helper: multi-part score */
function multiPartScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
    },
    parts: [
      {
        name: "Violin",
        measures: [
          {
            sequences: [
              {
                content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
                fullMeasure: { visualDuration: { base: "whole" } },
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
                content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
                fullMeasure: { visualDuration: { base: "whole" } },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("appendMeasure", () => {
  it("adds a new measure at the end", () => {
    const score = twoMeasureScore();
    const result = appendMeasure(score);

    expect(result.global.measures).toHaveLength(3);
    expect(result.parts[0]!.measures).toHaveLength(3);
  });

  it("does not mutate the original score", () => {
    const score = twoMeasureScore();
    const result = appendMeasure(score);

    expect(score.global.measures).toHaveLength(2);
    expect(score.parts[0]!.measures).toHaveLength(2);
    expect(result).not.toBe(score);
  });

  it("new measure has a full-measure rest", () => {
    const score = twoMeasureScore();
    const result = appendMeasure(score);
    const newMeasure = result.parts[0]!.measures[2]!;

    expect(newMeasure.sequences).toHaveLength(1);
    expect(newMeasure.sequences[0]).toEqual({
      content: [],
      fullMeasure: { visualDuration: { base: "whole" } },
    });
  });

  it("new global measure has no inherited properties", () => {
    const score = twoMeasureScore();
    const result = appendMeasure(score);
    const newGlobal = result.global.measures[2]!;

    expect(newGlobal.time).toBeUndefined();
    expect(newGlobal.key).toBeUndefined();
    expect(newGlobal.barline).toBeUndefined();
  });

  it("preserves existing measures (strips final barline from old last)", () => {
    const score = twoMeasureScore();
    const result = appendMeasure(score);

    expect(result.global.measures[0]).toEqual(score.global.measures[0]);
    // Final barline is stripped from the old last measure
    expect(result.global.measures[1]!.barline).toBeUndefined();
    expect(result.parts[0]!.measures[0]).toBe(score.parts[0]!.measures[0]);
  });

  it("adds a measure to all parts in a multi-part score", () => {
    const score = multiPartScore();
    const result = appendMeasure(score);

    expect(result.global.measures).toHaveLength(2);
    expect(result.parts[0]!.measures).toHaveLength(2);
    expect(result.parts[1]!.measures).toHaveLength(2);
  });

  it("works on a score with no parts", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [],
    };
    const result = appendMeasure(score);

    expect(result.global.measures).toHaveLength(2);
    expect(result.parts).toHaveLength(0);
  });
});

describe("insertMeasure", () => {
  it("inserts at the beginning (index 0)", () => {
    const score = twoMeasureScore();
    const result = insertMeasure(score, 0);

    expect(result.global.measures).toHaveLength(3);
    // Original first measure is now at index 1
    expect(result.global.measures[1]).toEqual(score.global.measures[0]);
    // New measure at index 0 is empty
    expect(result.global.measures[0]!.time).toBeUndefined();
    // Part measures shifted too
    expect(result.parts[0]!.measures).toHaveLength(3);
    expect(result.parts[0]!.measures[1]).toBe(score.parts[0]!.measures[0]);
  });

  it("inserts in the middle (index 1)", () => {
    const score = twoMeasureScore();
    const result = insertMeasure(score, 1);

    expect(result.global.measures).toHaveLength(3);
    expect(result.global.measures[0]).toEqual(score.global.measures[0]);
    expect(result.global.measures[2]).toEqual(score.global.measures[1]);
    // New measure is at index 1
    expect(result.parts[0]!.measures[1]!.sequences[0]!.fullMeasure).toBeDefined();
  });

  it("inserts at the end (index === length)", () => {
    const score = twoMeasureScore();
    const result = insertMeasure(score, 2);

    expect(result.global.measures).toHaveLength(3);
    expect(result.global.measures[0]).toEqual(score.global.measures[0]);
    expect(result.global.measures[1]).toEqual(score.global.measures[1]);
  });

  it("does not mutate the original score", () => {
    const score = twoMeasureScore();
    insertMeasure(score, 1);

    expect(score.global.measures).toHaveLength(2);
    expect(score.parts[0]!.measures).toHaveLength(2);
  });

  it("inserts into all parts", () => {
    const score = multiPartScore();
    const result = insertMeasure(score, 0);

    expect(result.parts[0]!.measures).toHaveLength(2);
    expect(result.parts[1]!.measures).toHaveLength(2);
  });

  it("throws on negative index", () => {
    const score = twoMeasureScore();
    expect(() => insertMeasure(score, -1)).toThrow(RangeError);
  });

  it("throws on index > measureCount", () => {
    const score = twoMeasureScore();
    expect(() => insertMeasure(score, 3)).toThrow(RangeError);
  });

  it("throws on non-integer index", () => {
    const score = twoMeasureScore();
    expect(() => insertMeasure(score, 1.5)).toThrow(RangeError);
  });
});

describe("deleteMeasure", () => {
  it("deletes the first measure", () => {
    const score = twoMeasureScore();
    const result = deleteMeasure(score, 0);

    expect(result.global.measures).toHaveLength(1);
    expect(result.global.measures[0]).toEqual(score.global.measures[1]);
    expect(result.parts[0]!.measures).toHaveLength(1);
    expect(result.parts[0]!.measures[0]).toBe(score.parts[0]!.measures[1]);
  });

  it("deletes the last measure", () => {
    const score = twoMeasureScore();
    const result = deleteMeasure(score, 1);

    expect(result.global.measures).toHaveLength(1);
    expect(result.global.measures[0]).toEqual(score.global.measures[0]);
  });

  it("does not mutate the original score", () => {
    const score = twoMeasureScore();
    deleteMeasure(score, 0);

    expect(score.global.measures).toHaveLength(2);
    expect(score.parts[0]!.measures).toHaveLength(2);
  });

  it("deletes from all parts", () => {
    const score = multiPartScore();
    // Need at least 2 measures to delete one
    const withTwo = appendMeasure(score);
    const result = deleteMeasure(withTwo, 0);

    expect(result.parts[0]!.measures).toHaveLength(1);
    expect(result.parts[1]!.measures).toHaveLength(1);
  });

  it("throws when trying to delete the only measure", () => {
    const score = multiPartScore(); // 1 measure
    expect(() => deleteMeasure(score, 0)).toThrow(RangeError);
    expect(() => deleteMeasure(score, 0)).toThrow("cannot delete the last measure");
  });

  it("throws on negative index", () => {
    const score = twoMeasureScore();
    expect(() => deleteMeasure(score, -1)).toThrow(RangeError);
  });

  it("throws on index >= measureCount", () => {
    const score = twoMeasureScore();
    expect(() => deleteMeasure(score, 2)).toThrow(RangeError);
  });

  it("throws on non-integer index", () => {
    const score = twoMeasureScore();
    expect(() => deleteMeasure(score, 0.5)).toThrow(RangeError);
  });
});

describe("compound operations", () => {
  it("insert then delete returns equivalent measure count", () => {
    const score = twoMeasureScore();
    const inserted = insertMeasure(score, 1);
    const deleted = deleteMeasure(inserted, 1);

    expect(deleted.global.measures).toHaveLength(2);
    expect(deleted.parts[0]!.measures).toHaveLength(2);
  });

  it("append then delete last restores original structure (minus final barline)", () => {
    const score = twoMeasureScore();
    const appended = appendMeasure(score);
    const deleted = deleteMeasure(appended, 2);

    expect(deleted.global.measures).toHaveLength(2);
    // Original data preserved except final barline was stripped
    expect(deleted.global.measures[0]).toEqual(score.global.measures[0]);
    expect(deleted.global.measures[1]!.barline).toBeUndefined();
  });

  it("multiple appends work correctly", () => {
    const score = twoMeasureScore();
    const r1 = appendMeasure(score);
    const r2 = appendMeasure(r1);
    const r3 = appendMeasure(r2);

    expect(r3.global.measures).toHaveLength(5);
    expect(r3.parts[0]!.measures).toHaveLength(5);
  });
});

describe("setTimeSignature", () => {
  it("sets a time signature on a measure", () => {
    const score = twoMeasureScore();
    const result = setTimeSignature(score, 1, { count: 3, unit: 4 });

    expect(result.global.measures[1]!.time).toEqual({ count: 3, unit: 4 });
  });

  it("overwrites an existing time signature", () => {
    const score = twoMeasureScore();
    // Measure 0 already has { count: 4, unit: 4 }
    const result = setTimeSignature(score, 0, { count: 6, unit: 8 });

    expect(result.global.measures[0]!.time).toEqual({ count: 6, unit: 8 });
  });

  it("removes time signature when null is passed", () => {
    const score = twoMeasureScore();
    // Measure 0 has an explicit time sig
    const result = setTimeSignature(score, 0, null);

    expect(result.global.measures[0]!.time).toBeUndefined();
  });

  it("does not mutate the original score", () => {
    const score = twoMeasureScore();
    setTimeSignature(score, 1, { count: 3, unit: 4 });

    expect(score.global.measures[1]!.time).toBeUndefined();
  });

  it("preserves other global measure properties", () => {
    const score = twoMeasureScore();
    // Measure 0 has time and key
    const result = setTimeSignature(score, 0, { count: 2, unit: 2 });

    expect(result.global.measures[0]!.key).toEqual({ fifths: 0 });
    expect(result.global.measures[0]!.time).toEqual({ count: 2, unit: 2 });
  });

  it("supports display property (common time)", () => {
    const score = twoMeasureScore();
    const result = setTimeSignature(score, 0, { count: 4, unit: 4, display: "common" });

    expect(result.global.measures[0]!.time).toEqual({ count: 4, unit: 4, display: "common" });
  });

  it("supports display property (cut time)", () => {
    const score = twoMeasureScore();
    const result = setTimeSignature(score, 0, { count: 2, unit: 2, display: "cut" });

    expect(result.global.measures[0]!.time).toEqual({ count: 2, unit: 2, display: "cut" });
  });

  it("throws on negative index", () => {
    const score = twoMeasureScore();
    expect(() => setTimeSignature(score, -1, { count: 3, unit: 4 })).toThrow(RangeError);
  });

  it("throws on index >= measureCount", () => {
    const score = twoMeasureScore();
    expect(() => setTimeSignature(score, 2, { count: 3, unit: 4 })).toThrow(RangeError);
  });

  it("throws on non-integer index", () => {
    const score = twoMeasureScore();
    expect(() => setTimeSignature(score, 0.5, { count: 3, unit: 4 })).toThrow(RangeError);
  });

  it("does not modify part measures", () => {
    const score = twoMeasureScore();
    const result = setTimeSignature(score, 0, { count: 3, unit: 4 });

    expect(result.parts).toBe(score.parts);
  });
});

describe("setKeySignature", () => {
  it("sets a key signature on a measure", () => {
    const score = twoMeasureScore();
    const result = setKeySignature(score, 1, { fifths: 3 });

    expect(result.global.measures[1]!.key).toEqual({ fifths: 3 });
  });

  it("overwrites an existing key signature", () => {
    const score = twoMeasureScore();
    // Measure 0 has { fifths: 0 }
    const result = setKeySignature(score, 0, { fifths: -4 });

    expect(result.global.measures[0]!.key).toEqual({ fifths: -4 });
  });

  it("removes key signature when null is passed", () => {
    const score = twoMeasureScore();
    const result = setKeySignature(score, 0, null);

    expect(result.global.measures[0]!.key).toBeUndefined();
  });

  it("does not mutate the original score", () => {
    const score = twoMeasureScore();
    setKeySignature(score, 0, { fifths: 5 });

    expect(score.global.measures[0]!.key).toEqual({ fifths: 0 });
  });

  it("preserves other global measure properties", () => {
    const score = twoMeasureScore();
    const result = setKeySignature(score, 0, { fifths: 2 });

    expect(result.global.measures[0]!.time).toEqual({ count: 4, unit: 4 });
    expect(result.global.measures[0]!.key).toEqual({ fifths: 2 });
  });

  it("handles all fifths values (-7 to 7)", () => {
    const score = twoMeasureScore();
    for (let fifths = -7; fifths <= 7; fifths++) {
      const result = setKeySignature(score, 0, { fifths });
      expect(result.global.measures[0]!.key).toEqual({ fifths });
    }
  });

  it("throws on negative index", () => {
    const score = twoMeasureScore();
    expect(() => setKeySignature(score, -1, { fifths: 0 })).toThrow(RangeError);
  });

  it("throws on index >= measureCount", () => {
    const score = twoMeasureScore();
    expect(() => setKeySignature(score, 2, { fifths: 0 })).toThrow(RangeError);
  });

  it("throws on non-integer index", () => {
    const score = twoMeasureScore();
    expect(() => setKeySignature(score, 0.5, { fifths: 0 })).toThrow(RangeError);
  });

  it("does not modify part measures", () => {
    const score = twoMeasureScore();
    const result = setKeySignature(score, 0, { fifths: 3 });

    expect(result.parts).toBe(score.parts);
  });
});

describe("setRepeatStart", () => {
  it("sets repeat start on a measure", () => {
    const score = twoMeasureScore();
    const result = setRepeatStart(score, 0, {});
    expect(result.global.measures[0]!.repeatStart).toEqual({});
  });

  describe("setMeasureRepeat", () => {
    it("sets and removes a part-specific measure repeat immutably", () => {
      const score = twoMeasureScore();
      const result = setMeasureRepeat(score, 0, 1, { number: 1 });

      expect(result.parts[0]!.measures[1]!.measureRepeat).toEqual({ number: 1 });
      expect(score.parts[0]!.measures[1]!.measureRepeat).toBeUndefined();
      expect(result.global).toBe(score.global);

      const removed = setMeasureRepeat(result, 0, 1, null);
      expect(removed.parts[0]!.measures[1]!.measureRepeat).toBeUndefined();
    });

    it("preserves the measure's sequences and other notation", () => {
      const score = twoMeasureScore();
      const sequences = score.parts[0]!.measures[1]!.sequences;
      const result = setMeasureRepeat(score, 0, 1, { number: 1, displayNumber: "yes" });

      expect(result.parts[0]!.measures[1]!.sequences).toBe(sequences);
      expect(result.parts[0]!.measures[1]!.measureRepeat).toEqual({ number: 1, displayNumber: "yes" });
    });

    it("rejects invalid part, measure, and span values", () => {
      const score = twoMeasureScore();
      expect(() => setMeasureRepeat(score, 1, 0, { number: 1 })).toThrow(RangeError);
      expect(() => setMeasureRepeat(score, 0, 2, { number: 1 })).toThrow(RangeError);
      expect(() => setMeasureRepeat(score, 0, 1, { number: 0 })).toThrow(RangeError);
    });
  });

  it("removes repeat start when null is passed", () => {
    const score = setRepeatStart(twoMeasureScore(), 0, { times: 2 });
    const result = setRepeatStart(score, 0, null);
    expect(result.global.measures[0]!.repeatStart).toBeUndefined();
  });

  it("preserves other measure properties", () => {
    const score = twoMeasureScore();
    const result = setRepeatStart(score, 0, {});
    expect(result.global.measures[0]!.time).toEqual({ count: 4, unit: 4 });
    expect(result.global.measures[0]!.key).toEqual({ fifths: 0 });
  });
});

describe("setRepeatEnd", () => {
  it("sets repeat end on a measure", () => {
    const score = twoMeasureScore();
    const result = setRepeatEnd(score, 1, { times: 3 });
    expect(result.global.measures[1]!.repeatEnd).toEqual({ times: 3 });
  });

  it("removes repeat end when null is passed", () => {
    const score = setRepeatEnd(twoMeasureScore(), 1, {});
    const result = setRepeatEnd(score, 1, null);
    expect(result.global.measures[1]!.repeatEnd).toBeUndefined();
  });

  it("throws on invalid index", () => {
    const score = twoMeasureScore();
    expect(() => setRepeatEnd(score, 2, {})).toThrow(RangeError);
  });
});

describe("setEnding", () => {
  it("sets ending on a measure", () => {
    const score = twoMeasureScore();
    const result = setEnding(score, 1, { duration: 1, numbers: [1] });
    expect(result.global.measures[1]!.ending).toEqual({ duration: 1, numbers: [1] });
  });

  it("removes ending when null is passed", () => {
    const score = setEnding(twoMeasureScore(), 1, { duration: 2, numbers: [1, 2], open: true });
    const result = setEnding(score, 1, null);
    expect(result.global.measures[1]!.ending).toBeUndefined();
  });

  it("does not mutate original score", () => {
    const score = twoMeasureScore();
    setEnding(score, 1, { duration: 1, numbers: [2] });
    expect(score.global.measures[1]!.ending).toBeUndefined();
  });
});

describe("setBarline", () => {
  it("sets a barline on a measure", () => {
    const score = twoMeasureScore();
    const result = setBarline(score, 0, { type: "double" });

    expect(result.global.measures[0]!.barline).toEqual({ type: "double" });
  });

  it("removes barline when null is passed", () => {
    const score = twoMeasureScore();
    const result = setBarline(score, 1, null);

    expect(result.global.measures[1]!.barline).toBeUndefined();
  });

  it("throws on out-of-range index", () => {
    const score = twoMeasureScore();
    expect(() => setBarline(score, 2, { type: "final" })).toThrow(RangeError);
  });
});

describe("setClef", () => {
  it("sets a clef on a part measure", () => {
    const score = twoMeasureScore();
    const result = setClef(score, 1, 0, { sign: "F", staffPosition: 2 });

    expect(result.parts[0]!.measures[1]!.clefs).toEqual([{ clef: { sign: "F", staffPosition: 2 } }]);
  });

  it("removes clefs when null is passed", () => {
    const score = twoMeasureScore();
    const withClef = setClef(score, 1, 0, { sign: "G", staffPosition: -2 });
    const result = setClef(withClef, 1, 0, null);

    expect(result.parts[0]!.measures[1]!.clefs).toBeUndefined();
  });

  it("throws on out-of-range part index", () => {
    const score = twoMeasureScore();
    expect(() => setClef(score, 0, 9, { sign: "G", staffPosition: -2 })).toThrow(RangeError);
  });

  it("inserts a mid-measure clef change at explicit position", () => {
    const score = twoMeasureScore();
    const withStart = setClef(score, 1, 0, { sign: "G", staffPosition: -2 });
    const result = setClef(
      withStart,
      1,
      0,
      { sign: "F", staffPosition: 2 },
      { position: { fraction: [1, 2] }, staff: 1 },
    );

    expect(result.parts[0]!.measures[1]!.clefs).toEqual([
      { clef: { sign: "G", staffPosition: -2 } },
      {
        clef: { sign: "F", staffPosition: 2 },
        position: { fraction: [1, 2] },
        staff: 1,
      },
    ]);
  });
});

describe("ID assignment", () => {
  const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("appendMeasure assigns an ID to the new global measure", () => {
    const score = twoMeasureScore();
    const result = appendMeasure(score);
    const newGlobal = result.global.measures[2]!;
    expect(newGlobal.id).toBeDefined();
    expect(newGlobal.id).toMatch(UUID_V7);
  });

  it("insertMeasure assigns an ID to the new global measure", () => {
    const score = twoMeasureScore();
    const result = insertMeasure(score, 1);
    const newGlobal = result.global.measures[1]!;
    expect(newGlobal.id).toBeDefined();
    expect(newGlobal.id).toMatch(UUID_V7);
  });

  it("appendMeasure assigns unique IDs across multiple appends", () => {
    let score = twoMeasureScore();
    const ids = new Set<string>();
    for (let i = 0; i < 10; i++) {
      score = appendMeasure(score);
      const id = score.global.measures[score.global.measures.length - 1]!.id!;
      expect(ids.has(id)).toBe(false);
      ids.add(id);
    }
  });

  it("preserves existing IDs on unmodified measures", () => {
    const score = twoMeasureScore();
    score.global.measures[0]!.id = "existing1";
    score.global.measures[1]!.id = "existing2";
    const result = appendMeasure(score);
    expect(result.global.measures[0]!.id).toBe("existing1");
    // Note: barline stripping creates a new object, but ID is preserved via spread
    expect(result.global.measures[1]!.id).toBe("existing2");
  });
});
