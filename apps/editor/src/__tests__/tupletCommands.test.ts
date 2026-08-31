import { describe, it, expect, beforeEach } from "vitest";
import type { Score, NoteEvent, Tuplet, Sequence, SequenceContent } from "@viritura/core";
import { isRest } from "@viritura/core";
import {
  createTuplet,
  createTupletFromEvent,
  getTupletOuterMultiple,
  parseTupletRatio,
  tupletTotalBeats,
} from "../commands/tupletCommands";
import { resetIdCounter, sequenceContentBeats } from "../commands/noteCommands";

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function makeEmptyScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
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
                    rest: {},
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeScoreWithQuarterRests(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, rest: {} },
                  { type: "event", duration: { base: "quarter" }, rest: {} },
                  { type: "event", duration: { base: "quarter" }, rest: {} },
                  { type: "event", duration: { base: "quarter" }, rest: {} },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeScoreWithNote(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
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
                    id: "note1",
                    duration: { base: "half" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                  {
                    type: "event",
                    duration: { base: "half" },
                    rest: {},
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function seq(score: Score, partIdx = 0, voice = 0): Sequence {
  return score.parts[partIdx]!.measures[0]!.sequences[voice]!;
}

function isTuplet(content: SequenceContent): content is Tuplet {
  return content.type === "tuplet";
}

// ═══════════════════════════════════════════
// getTupletOuterMultiple
// ═══════════════════════════════════════════

describe("getTupletOuterMultiple", () => {
  it("returns 3 for duplet (2:3)", () => {
    expect(getTupletOuterMultiple(2)).toBe(3);
  });

  it("returns 2 for triplet (3:2)", () => {
    expect(getTupletOuterMultiple(3)).toBe(2);
  });

  it("returns 4 for quintuplet (5:4)", () => {
    expect(getTupletOuterMultiple(5)).toBe(4);
  });

  it("returns 4 for sextuplet (6:4)", () => {
    expect(getTupletOuterMultiple(6)).toBe(4);
  });

  it("returns 4 for septuplet (7:4)", () => {
    expect(getTupletOuterMultiple(7)).toBe(4);
  });

  it("returns 8 for 9-tuplet (9:8)", () => {
    expect(getTupletOuterMultiple(9)).toBe(8);
  });
});

describe("parseTupletRatio", () => {
  it("accepts a spaced notes:time ratio", () => {
    expect(parseTupletRatio(" 7 : 5 ")).toEqual({ inner: 7, outer: 5 });
  });

  it("rejects malformed and out-of-range ratios", () => {
    expect(parseTupletRatio("3/2")).toBeNull();
    expect(parseTupletRatio("1:1")).toBeNull();
    expect(parseTupletRatio("33:32")).toBeNull();
    expect(parseTupletRatio("3:0")).toBeNull();
    expect(parseTupletRatio("3:3")).toBeNull();
  });
});

// ═══════════════════════════════════════════
// tupletTotalBeats
// ═══════════════════════════════════════════

describe("tupletTotalBeats", () => {
  it("computes beats for a triplet of eighths (2 × 0.5 = 1)", () => {
    expect(tupletTotalBeats({ multiple: 2, duration: { base: "eighth" } })).toBe(1);
  });

  it("computes beats for a triplet of quarters (2 × 1 = 2)", () => {
    expect(tupletTotalBeats({ multiple: 2, duration: { base: "quarter" } })).toBe(2);
  });

  it("computes beats for a quintuplet of 16ths (4 × 0.25 = 1)", () => {
    expect(tupletTotalBeats({ multiple: 4, duration: { base: "16th" } })).toBe(1);
  });
});

// ═══════════════════════════════════════════
// sequenceContentBeats for tuplets
// ═══════════════════════════════════════════

describe("sequenceContentBeats", () => {
  it("returns correct beats for a NoteEvent", () => {
    const ev: NoteEvent = { type: "event", duration: { base: "quarter" }, rest: {} };
    expect(sequenceContentBeats(ev)).toBe(1);
  });

  it("returns correct beats for a Tuplet", () => {
    const tuplet: Tuplet = {
      type: "tuplet",
      inner: { multiple: 3, duration: { base: "eighth" } },
      outer: { multiple: 2, duration: { base: "eighth" } },
      content: [],
    };
    expect(sequenceContentBeats(tuplet)).toBe(1);
  });
});

// ═══════════════════════════════════════════
// createTuplet (note input mode)
// ═══════════════════════════════════════════

describe("createTuplet", () => {
  beforeEach(() => resetIdCounter());

  it("creates a triplet of eighths at beat 0, replacing whole rest", () => {
    const score = makeEmptyScore();
    createTuplet(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      tupletNumber: 3,
      baseDuration: { base: "eighth" },
    });

    const s = seq(score);
    // Should be: tuplet (1 beat) + rests (3 beats)
    expect(isTuplet(s.content[0]!)).toBe(true);

    const tuplet = s.content[0] as Tuplet;
    expect(tuplet.inner.multiple).toBe(3);
    expect(tuplet.inner.duration.base).toBe("eighth");
    expect(tuplet.outer.multiple).toBe(2);
    expect(tuplet.outer.duration.base).toBe("eighth");
    expect(tuplet.content.length).toBe(3);

    // All sub-events are eighth rests
    for (const ev of tuplet.content) {
      expect(ev.type).toBe("event");
      const noteEv = ev as NoteEvent;
      expect(noteEv.duration.base).toBe("eighth");
      expect(isRest(noteEv)).toBe(true);
    }

    // Total beats: tuplet (1) + remaining rests (3) = 4
    let totalBeats = 0;
    for (const item of s.content) {
      totalBeats += sequenceContentBeats(item);
    }
    expect(totalBeats).toBeCloseTo(4);
  });

  it("creates a triplet of quarters at beat 0, replacing whole rest", () => {
    const score = makeEmptyScore();
    createTuplet(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      tupletNumber: 3,
      baseDuration: { base: "quarter" },
    });

    const s = seq(score);
    expect(isTuplet(s.content[0]!)).toBe(true);

    const tuplet = s.content[0] as Tuplet;
    expect(tuplet.inner.multiple).toBe(3);
    expect(tuplet.outer.multiple).toBe(2);
    expect(tuplet.content.length).toBe(3);

    // Total tuplet beats = 2 quarters = 2 beats
    expect(sequenceContentBeats(tuplet)).toBe(2);

    // Total measure beats = 4
    let totalBeats = 0;
    for (const item of s.content) {
      totalBeats += sequenceContentBeats(item);
    }
    expect(totalBeats).toBeCloseTo(4);
  });

  it("creates a quintuplet of 16ths at beat 0", () => {
    const score = makeScoreWithQuarterRests();
    createTuplet(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      tupletNumber: 5,
      baseDuration: { base: "16th" },
    });

    const s = seq(score);
    expect(isTuplet(s.content[0]!)).toBe(true);

    const tuplet = s.content[0] as Tuplet;
    expect(tuplet.inner.multiple).toBe(5);
    expect(tuplet.outer.multiple).toBe(4);
    expect(tuplet.content.length).toBe(5);

    // Total tuplet beats = 4 × 0.25 = 1 beat
    expect(sequenceContentBeats(tuplet)).toBe(1);
  });

  it("creates tuplet at beat 2 in middle of measure", () => {
    const score = makeScoreWithQuarterRests();
    createTuplet(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2,
      tupletNumber: 3,
      baseDuration: { base: "eighth" },
    });

    const s = seq(score);
    // Beat 0-1: two quarter rests, then tuplet at beat 2, then quarter rest at beat 3
    let totalBeats = 0;
    for (const item of s.content) {
      totalBeats += sequenceContentBeats(item);
    }
    expect(totalBeats).toBeCloseTo(4);

    // Find the tuplet
    const tupletItem = s.content.find((c) => isTuplet(c));
    expect(tupletItem).toBeDefined();
  });

  it("creates new voice if needed", () => {
    const score = makeEmptyScore();
    createTuplet(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 1,
      beatPosition: 0,
      tupletNumber: 3,
      baseDuration: { base: "eighth" },
    });

    expect(score.parts[0]!.measures[0]!.sequences.length).toBe(2);
    const s = score.parts[0]!.measures[0]!.sequences[1]!;
    expect(isTuplet(s.content[0]!)).toBe(true);
  });

  it("clears fullMeasure flag", () => {
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
                  content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
                  fullMeasure: { visualDuration: { base: "whole" } },
                },
              ],
            },
          ],
        },
      ],
    };

    createTuplet(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      tupletNumber: 3,
      baseDuration: { base: "eighth" },
    });

    expect(seq(score).fullMeasure).toBeUndefined();
  });

  it("throws on invalid tuplet number", () => {
    const score = makeEmptyScore();
    expect(() =>
      createTuplet(score, {
        measureIndex: 0,
        partIndex: 0,
        voice: 0,
        beatPosition: 0,
        tupletNumber: 1,
        baseDuration: { base: "eighth" },
      }),
    ).toThrow("Invalid tuplet number");
  });

  it("throws on invalid tuplet number > 32", () => {
    const score = makeEmptyScore();
    expect(() =>
      createTuplet(score, {
        measureIndex: 0,
        partIndex: 0,
        voice: 0,
        beatPosition: 0,
        tupletNumber: 33,
        baseDuration: { base: "eighth" },
      }),
    ).toThrow("Invalid tuplet number");
  });

  it("throws when position is not a rest", () => {
    const score = makeScoreWithNote();
    expect(() =>
      createTuplet(score, {
        measureIndex: 0,
        partIndex: 0,
        voice: 0,
        beatPosition: 0,
        tupletNumber: 3,
        baseDuration: { base: "eighth" },
      }),
    ).toThrow("Cannot create tuplet: position is not a rest");
  });

  it("rejects a tuplet that would cross the barline", () => {
    const score = makeScoreWithQuarterRests();
    expect(() =>
      createTuplet(score, {
        measureIndex: 0,
        partIndex: 0,
        voice: 0,
        beatPosition: 3.5,
        tupletNumber: 3,
        baseDuration: { base: "eighth" },
      }),
    ).toThrow("Tuplet does not fit before the end of the measure");
  });

  it("appends tuplet beyond existing content", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [{ content: [] }],
            },
          ],
        },
      ],
    };

    createTuplet(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      tupletNumber: 3,
      baseDuration: { base: "eighth" },
    });

    const s = seq(score);
    expect(isTuplet(s.content[0]!)).toBe(true);
  });
});

// ═══════════════════════════════════════════
// createTupletFromEvent (selection mode)
// ═══════════════════════════════════════════

describe("createTupletFromEvent", () => {
  beforeEach(() => resetIdCounter());

  it("replaces a half rest with a triplet of quarter rests", () => {
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
                    { type: "event", duration: { base: "half" }, rest: {} },
                    { type: "event", duration: { base: "half" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    createTupletFromEvent(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
      tupletNumber: 3,
    });

    const s = seq(score);
    expect(isTuplet(s.content[0]!)).toBe(true);

    const tuplet = s.content[0] as Tuplet;
    // Half note = 2 beats, outer multiple = 2, sub = quarter
    expect(tuplet.inner.multiple).toBe(3);
    expect(tuplet.inner.duration.base).toBe("quarter");
    expect(tuplet.outer.multiple).toBe(2);
    expect(tuplet.outer.duration.base).toBe("quarter");
    expect(tuplet.content.length).toBe(3);

    // Total beats should be preserved (2 for tuplet + 2 for remaining half)
    let totalBeats = 0;
    for (const item of s.content) {
      totalBeats += sequenceContentBeats(item);
    }
    expect(totalBeats).toBeCloseTo(4);
  });

  it("replaces a quarter rest with a triplet of eighth rests", () => {
    const score = makeScoreWithQuarterRests();
    createTupletFromEvent(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 1,
      tupletNumber: 3,
    });

    const s = seq(score);
    expect(isTuplet(s.content[1]!)).toBe(true);

    const tuplet = s.content[1] as Tuplet;
    expect(tuplet.inner.duration.base).toBe("eighth");
    expect(tuplet.outer.duration.base).toBe("eighth");
    expect(tuplet.content.length).toBe(3);

    // Quarter = 1 beat, tuplet takes same space
    expect(sequenceContentBeats(tuplet)).toBe(1);
  });

  it("preserves note when converting to tuplet", () => {
    const score = makeScoreWithNote();
    const original = seq(score).content[0] as NoteEvent;
    original.staff = 2;
    original.stemDirection = "down";
    original.markings = { articulations: [{ type: "staccato" }] };
    original.lyrics = { lines: [{ text: "la" }] };
    createTupletFromEvent(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
      tupletNumber: 3,
    });

    const s = seq(score);
    expect(isTuplet(s.content[0]!)).toBe(true);

    const tuplet = s.content[0] as Tuplet;
    // First event should be the original note
    const firstEvent = tuplet.content[0] as NoteEvent;
    expect(isRest(firstEvent)).toBe(false);
    expect(firstEvent.notes![0]!.pitch.step).toBe("C");
    expect(firstEvent.staff).toBe(2);
    expect(firstEvent.stemDirection).toBe("down");
    expect(firstEvent.markings).toEqual(original.markings);
    expect(firstEvent.lyrics).toEqual(original.lyrics);

    // Remaining events are rests
    for (let i = 1; i < tuplet.content.length; i++) {
      expect(isRest(tuplet.content[i] as NoteEvent)).toBe(true);
    }
  });

  it("creates quintuplet from whole note", () => {
    const score = makeEmptyScore();
    createTupletFromEvent(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
      tupletNumber: 5,
    });

    const s = seq(score);
    expect(isTuplet(s.content[0]!)).toBe(true);

    const tuplet = s.content[0] as Tuplet;
    // Whole = 4 beats, outer multiple = 4, sub = quarter
    expect(tuplet.inner.multiple).toBe(5);
    expect(tuplet.inner.duration.base).toBe("quarter");
    expect(tuplet.outer.multiple).toBe(4);
    expect(tuplet.content.length).toBe(5);

    // Tuplet should occupy same 4 beats
    expect(sequenceContentBeats(tuplet)).toBeCloseTo(4);
  });

  it("throws on invalid tuplet number", () => {
    const score = makeEmptyScore();
    expect(() =>
      createTupletFromEvent(score, {
        measureIndex: 0,
        partIndex: 0,
        voice: 0,
        eventIndex: 0,
        tupletNumber: 0,
      }),
    ).toThrow("Invalid tuplet number");
  });

  it("supports an exact dotted subdivision", () => {
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
                    { type: "event", duration: { base: "quarter", dots: 1 }, rest: {} },
                    { type: "event", duration: { base: "quarter" }, rest: {} },
                    { type: "event", duration: { base: "half" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    createTupletFromEvent(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
      tupletNumber: 5,
    });

    const tuplet = seq(score).content[0] as Tuplet;
    expect(tuplet.inner.duration).toEqual({ base: "16th", dots: 1 });
    expect(sequenceContentBeats(tuplet)).toBeCloseTo(1.5);
  });

  it("throws when the requested ratio has no exact subdivision", () => {
    const score = makeScoreWithNote();
    expect(() =>
      createTupletFromEvent(score, {
        measureIndex: 0,
        partIndex: 0,
        voice: 0,
        eventIndex: 0,
        tupletNumber: 7,
        outerMultiple: 5,
      }),
    ).toThrow("Duration cannot be evenly divided");
  });

  it("clears fullMeasure flag", () => {
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
                  content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
                  fullMeasure: { visualDuration: { base: "whole" } },
                },
              ],
            },
          ],
        },
      ],
    };

    createTupletFromEvent(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
      tupletNumber: 3,
    });

    expect(seq(score).fullMeasure).toBeUndefined();
  });
});
