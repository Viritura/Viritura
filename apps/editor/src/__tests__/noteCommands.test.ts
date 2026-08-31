import { describe, it, expect, beforeEach } from "vitest";
import type { Score } from "@viritura/core";
import type { NoteEvent, Sequence } from "@viritura/core";
import { isRest } from "@viritura/core";
import {
  addNote,
  addSlur,
  findForwardSlurTargetId,
  setNoteAccidentalDisplay,
  toggleCourtesyAccidental,
  addNoteWithAutoTie,
  addRest,
  addPitchToChord,
  findLastNoteEvent,
  deleteNote,
  changePitch,
  changeDuration,
  durationToBeats,
  sequenceContentBeats,
  beatsToNoteValueBase,
  decomposeDuration,
  decomposeRestsAtPosition,
  generateEventId,
  getEffectiveTimeSignature,
  resetIdCounter,
  backspaceInNoteInput,
  setTieProperties,
  setSlurProperties,
  toggleRestAtLocations,
  toggleDotAtLocations,
} from "../commands/noteCommands";

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function makeEmptyScore(timeSig: { count: number; unit: number }): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: timeSig }],
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
        id: "p1",
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

function seq(score: Score, partIdx = 0, voice = 0): Sequence {
  return score.parts[partIdx]!.measures[0]!.sequences[voice]!;
}

function contentAt(score: Score, idx: number, partIdx = 0, voice = 0): NoteEvent {
  return seq(score, partIdx, voice).content[idx]!;
}

// ═══════════════════════════════════════════
// Duration math
// ═══════════════════════════════════════════

describe("durationToBeats", () => {
  it("converts quarter note to 1 beat", () => {
    expect(durationToBeats({ base: "quarter" })).toBe(1);
  });

  it("converts whole note to 4 beats", () => {
    expect(durationToBeats({ base: "whole" })).toBe(4);
  });

  it("converts half note to 2 beats", () => {
    expect(durationToBeats({ base: "half" })).toBe(2);
  });

  it("converts eighth note to 0.5 beats", () => {
    expect(durationToBeats({ base: "eighth" })).toBe(0.5);
  });

  it("handles dotted quarter (1.5 beats)", () => {
    expect(durationToBeats({ base: "quarter", dots: 1 })).toBe(1.5);
  });

  it("handles double-dotted quarter (1.75 beats)", () => {
    expect(durationToBeats({ base: "quarter", dots: 2 })).toBe(1.75);
  });

  it("handles dotted half (3 beats)", () => {
    expect(durationToBeats({ base: "half", dots: 1 })).toBe(3);
  });
});

describe("beatsToNoteValueBase", () => {
  it("returns whole for 4 beats", () => {
    expect(beatsToNoteValueBase(4)).toBe("whole");
  });

  it("returns quarter for 1 beat", () => {
    expect(beatsToNoteValueBase(1)).toBe("quarter");
  });

  it("returns half for 2 beats", () => {
    expect(beatsToNoteValueBase(2)).toBe("half");
  });

  it("returns eighth for 0.5 beats", () => {
    expect(beatsToNoteValueBase(0.5)).toBe("eighth");
  });

  it("returns quarter for 1.5 beats (largest fitting)", () => {
    expect(beatsToNoteValueBase(1.5)).toBe("quarter");
  });
});

describe("decomposeDuration", () => {
  it("decomposes 4 beats into whole", () => {
    expect(decomposeDuration(4)).toEqual([{ base: "whole" }]);
  });

  it("decomposes 3 beats into dotted half", () => {
    expect(decomposeDuration(3)).toEqual([{ base: "half", dots: 1 }]);
  });

  it("decomposes 1.5 beats into dotted quarter", () => {
    expect(decomposeDuration(1.5)).toEqual([{ base: "quarter", dots: 1 }]);
  });

  it("decomposes 0 beats into empty array", () => {
    expect(decomposeDuration(0)).toEqual([]);
  });
});

describe("decomposeRestsAtPosition", () => {
  const ts44 = { count: 4, unit: 4 }; // 4/4: beatUnit = 1 quarter

  it("3.75 beats at beat 0.25 in 4/4 → [16th, dotted-8th, half, quarter] (not double-dotted-half)", () => {
    const result = decomposeRestsAtPosition(3.75, 0.25, ts44);
    const beats = result.map(durationToBeats);
    expect(beats.reduce((a, b) => a + b, 0)).toBeCloseTo(3.75);
    // No single rest should span beat 2 (the half-bar), which starts at beat 2
    // relative to measure start = beat 0.25 relative to our start.
    // Max allowed rest touching beat 0.25 is a dotted-8th (0.75 beats).
    expect(beats[0]).toBeLessThanOrEqual(0.75 + 1e-9);
  });

  it("3.75 beats at beat 0.25 does NOT produce a double-dotted-half", () => {
    const result = decomposeRestsAtPosition(3.75, 0.25, ts44);
    expect(result.some((d) => d.base === "half" && d.dots === 2)).toBe(false);
  });

  it("3.25 beats at beat 0.75 in 4/4 decomposes without crossing half-bar", () => {
    const result = decomposeRestsAtPosition(3.25, 0.75, ts44);
    const beats = result.map(durationToBeats);
    expect(beats.reduce((a, b) => a + b, 0)).toBeCloseTo(3.25);
    // First rest starts at 0.75; half-bar is beat 2 → only 1.25 beats away,
    // so no rest longer than 1.25 should start at 0.75
    expect(beats[0]).toBeLessThanOrEqual(1.25 + 1e-9);
  });

  it("2 beats at beat 0 in 4/4 → [half] (metrically clean, no split needed)", () => {
    const result = decomposeRestsAtPosition(2, 0, ts44);
    expect(result).toEqual([{ base: "half" }]);
  });

  it("2 beats at beat 1 in 4/4 → [quarter, quarter] (crosses half-bar)", () => {
    const result = decomposeRestsAtPosition(2, 1, ts44);
    expect(result).toEqual([{ base: "quarter" }, { base: "quarter" }]);
  });

  it("4 beats at beat 0 in 4/4 → [whole]", () => {
    const result = decomposeRestsAtPosition(4, 0, ts44);
    expect(result).toEqual([{ base: "whole" }]);
  });

  it("sums match total beats for a 16th note at beat 0 in 4/4", () => {
    const result = decomposeRestsAtPosition(3.75, 0.25, ts44);
    const total = result.map(durationToBeats).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(3.75);
  });
});

// ═══════════════════════════════════════════
// addNote
// ═══════════════════════════════════════════

describe("addNote", () => {
  beforeEach(() => resetIdCounter());

  it("adds a quarter note at beat 0, replacing whole rest", () => {
    const score = makeEmptyScore({ count: 4, unit: 4 });
    const result = addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    const s = seq(result);
    // First event is our note
    expect(s.content.length).toBeGreaterThanOrEqual(2);
    expect(isRest(s.content[0]!)).toBe(false);
    expect(s.content[0]!.notes![0]!.pitch.step).toBe("C");
    expect(s.content[0]!.notes![0]!.pitch.octave).toBe(4);
    expect(s.content[0]!.duration.base).toBe("quarter");

    // Remaining beats should be rests totaling 3 beats
    let restBeats = 0;
    for (let i = 1; i < s.content.length; i++) {
      expect(isRest(s.content[i]!)).toBe(true);
      restBeats += durationToBeats(s.content[i]!.duration);
    }
    expect(restBeats).toBeCloseTo(3);
  });

  it("adds a quarter note at beat 2 in whole rest, splitting rest", () => {
    const score = makeEmptyScore({ count: 4, unit: 4 });
    const result = addNote(score, {
      pitch: { step: "E", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2,
    });

    const s = seq(result);
    // Should be: half rest (2 beats) + quarter note + quarter rest
    let totalBeats = 0;
    for (const ev of s.content) {
      totalBeats += durationToBeats(ev.duration);
    }
    expect(totalBeats).toBeCloseTo(4);

    // Find the note
    const noteEvent = s.content.find((e) => !isRest(e));
    expect(noteEvent).toBeDefined();
    expect(noteEvent!.notes![0]!.pitch.step).toBe("E");
    expect(noteEvent!.duration.base).toBe("quarter");
  });

  it("replaces a quarter rest at exact beat position", () => {
    const score = makeScoreWithQuarterRests();
    const result = addNote(score, {
      pitch: { step: "G", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1, // second quarter rest
    });

    const s = seq(result);
    expect(s.content.length).toBe(4);
    expect(isRest(s.content[0]!)).toBe(true);
    expect(isRest(s.content[1]!)).toBe(false);
    expect(s.content[1]!.notes![0]!.pitch.step).toBe("G");
    expect(isRest(s.content[2]!)).toBe(true);
    expect(isRest(s.content[3]!)).toBe(true);
  });

  it("overwrites existing note when adding at same position with same duration", () => {
    const score = makeScoreWithQuarterRests();
    // First add a note at beat 0
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    // Now add another note at the same position — should overwrite, not chord
    addNote(score, {
      pitch: { step: "E", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    const event = contentAt(score, 0);
    expect(event.notes!.length).toBe(1);
    expect(event.notes![0]!.pitch.step).toBe("E");
  });

  it("generates unique event IDs", () => {
    const score = makeScoreWithQuarterRests();
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });
    addNote(score, {
      pitch: { step: "D", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1,
    });

    const id1 = contentAt(score, 0).id;
    const id2 = contentAt(score, 1).id;
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });

  it("creates new voice if voice index exceeds existing sequences", () => {
    const score = makeEmptyScore({ count: 4, unit: 4 });
    const result = addNote(score, {
      pitch: { step: "A", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 1,
      beatPosition: 0,
    });

    expect(result.parts[0]!.measures[0]!.sequences.length).toBe(2);
    const voice2 = result.parts[0]!.measures[0]!.sequences[1]!;
    expect(voice2.content.length).toBe(1);
    expect(voice2.content[0]!.notes![0]!.pitch.step).toBe("A");
  });

  it("clears fullMeasure flag after adding note", () => {
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

    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    expect(seq(score).fullMeasure).toBeUndefined();
  });

  it("throws on invalid part index", () => {
    const score = makeEmptyScore({ count: 4, unit: 4 });
    expect(() =>
      addNote(score, {
        pitch: { step: "C", octave: 4 },
        duration: { base: "quarter" },
        measureIndex: 0,
        partIndex: 5,
        voice: 0,
        beatPosition: 0,
      }),
    ).toThrow("Part 5 not found");
  });

  it("adds half note at beat 0, leaves half rest", () => {
    const score = makeEmptyScore({ count: 4, unit: 4 });
    const result = addNote(score, {
      pitch: { step: "D", octave: 5 },
      duration: { base: "half" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    const s = seq(result);
    expect(isRest(s.content[0]!)).toBe(false);
    expect(s.content[0]!.duration.base).toBe("half");

    // Remaining should be 2 beats of rest
    let restBeats = 0;
    for (let i = 1; i < s.content.length; i++) {
      restBeats += durationToBeats(s.content[i]!.duration);
    }
    expect(restBeats).toBeCloseTo(2);
  });
});

// ═══════════════════════════════════════════
// addNote — overwrite mode
// ═══════════════════════════════════════════

describe("addNote overwrite mode", () => {
  beforeEach(() => resetIdCounter());

  it("overwrites a note with a shorter note, inserting rest for remainder", () => {
    const score = makeScoreWithQuarterRests();
    // Add a half note at beat 0 (consumes beats 0-1)
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "half" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    // Overwrite with an eighth note at beat 0
    addNote(score, {
      pitch: { step: "D", octave: 4 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    const s = seq(score);
    // First event should be the new eighth note
    expect(isRest(s.content[0]!)).toBe(false);
    expect(s.content[0]!.notes![0]!.pitch.step).toBe("D");
    expect(s.content[0]!.duration.base).toBe("eighth");

    // Total beats should still be 4
    let total = 0;
    for (const e of s.content) {
      total += durationToBeats(e.duration);
    }
    expect(total).toBeCloseTo(4);
  });

  it("overwrites a note with a longer note, consuming following rests", () => {
    const score = makeScoreWithQuarterRests();
    // Add a quarter note at beat 0
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    // Overwrite with a half note at beat 0 (consumes the following quarter rest)
    addNote(score, {
      pitch: { step: "E", octave: 4 },
      duration: { base: "half" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    const s = seq(score);
    expect(isRest(s.content[0]!)).toBe(false);
    expect(s.content[0]!.notes![0]!.pitch.step).toBe("E");
    expect(s.content[0]!.duration.base).toBe("half");

    // Total beats should still be 4
    let total = 0;
    for (const e of s.content) {
      total += durationToBeats(e.duration);
    }
    expect(total).toBeCloseTo(4);
  });

  it("preserves total measure duration after overwrite", () => {
    const score = makeScoreWithQuarterRests();
    // Fill measure: C4-D4-E4-F4 (all quarter notes)
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });
    addNote(score, {
      pitch: { step: "D", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1,
    });
    addNote(score, {
      pitch: { step: "E", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2,
    });
    addNote(score, {
      pitch: { step: "F", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 3,
    });

    // Overwrite beat 1 with a different note
    addNote(score, {
      pitch: { step: "G", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1,
    });

    const s = seq(score);
    expect(s.content[1]!.notes![0]!.pitch.step).toBe("G");

    let total = 0;
    for (const e of s.content) {
      total += durationToBeats(e.duration);
    }
    expect(total).toBeCloseTo(4);
  });
});

// ═══════════════════════════════════════════
// addRest
// ═══════════════════════════════════════════

describe("addRest", () => {
  beforeEach(() => resetIdCounter());

  it("replaces existing note at beat position with a rest", () => {
    const score = makeScoreWithQuarterRests();
    // Add a note at beat 0
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });
    expect(isRest(contentAt(score, 0))).toBe(false);

    // Replace it with a rest
    addRest(score, {
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    // All events should be rests now
    for (const ev of seq(score).content) {
      expect(isRest(ev)).toBe(true);
    }
  });

  it("replaces a note with a shorter rest, inserting remainder rest", () => {
    const score = makeScoreWithQuarterRests();
    // Add a half note at beat 0
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "half" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    // Replace with quarter rest
    addRest(score, {
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    // All should be rests, total 4 beats
    let total = 0;
    for (const ev of seq(score).content) {
      expect(isRest(ev)).toBe(true);
      total += durationToBeats(ev.duration);
    }
    expect(total).toBeCloseTo(4);
  });

  it("replaces a rest at specific beat position", () => {
    const score = makeEmptyScore({ count: 4, unit: 4 });
    // Add rest at beat 0 (should just work on the existing whole rest)
    addRest(score, {
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    const s = seq(score);
    let total = 0;
    for (const ev of s.content) {
      expect(isRest(ev)).toBe(true);
      total += durationToBeats(ev.duration);
    }
    expect(total).toBeCloseTo(4);
  });

  it("maintains measure duration after rest insertion", () => {
    const score = makeScoreWithQuarterRests();
    // Fill with notes
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });
    addNote(score, {
      pitch: { step: "D", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1,
    });

    // Add rest at beat 0
    addRest(score, {
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    const s = seq(score);
    expect(isRest(s.content[0]!)).toBe(true);
    // The note at beat 1 should still be there
    expect(isRest(s.content[1]!)).toBe(false);
    expect(s.content[1]!.notes![0]!.pitch.step).toBe("D");

    let total = 0;
    for (const e of s.content) {
      total += durationToBeats(e.duration);
    }
    expect(total).toBeCloseTo(4);
  });
});

// ═══════════════════════════════════════════
// deleteNote
// ═══════════════════════════════════════════

describe("deleteNote", () => {
  beforeEach(() => resetIdCounter());

  it("replaces a note with a rest of same duration", () => {
    const score = makeScoreWithQuarterRests();
    // Add a note first
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1,
    });
    expect(isRest(contentAt(score, 1))).toBe(false);

    // Delete it
    deleteNote(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 1,
    });

    expect(seq(score).content).toEqual([]);
    expect(seq(score).fullMeasure).toEqual({ visualDuration: { base: "whole" } });
  });

  it("resets a rest-only measure to a bar rest when deleting a rest", () => {
    const score = makeScoreWithQuarterRests();

    deleteNote(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
    });

    expect(seq(score).content).toEqual([]);
    expect(seq(score).fullMeasure).toEqual({ visualDuration: { base: "whole" } });
  });

  it("merges adjacent rests after deletion", () => {
    const score = makeScoreWithQuarterRests();
    // Add notes at beats 0 and 2
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });
    addNote(score, {
      pitch: { step: "E", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2,
    });

    // Delete note at index 0 — now beats 0,1 are rests → should merge to half rest
    deleteNote(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
    });

    const s = seq(score);
    // First event should be a merged half rest
    expect(isRest(s.content[0]!)).toBe(true);
    expect(durationToBeats(s.content[0]!.duration)).toBe(2);
  });

  it("throws on invalid event index", () => {
    const score = makeEmptyScore({ count: 4, unit: 4 });
    expect(() =>
      deleteNote(score, {
        measureIndex: 0,
        partIndex: 0,
        voice: 0,
        eventIndex: 99,
      }),
    ).toThrow("Event 99 not found");
  });

  it("deleting a note in a multi-note tremolo unwraps it and restores durations", () => {
    const score = makeEmptyScore({ count: 4, unit: 4 });
    seq(score).content = [
      {
        type: "tremolo",
        marks: 2,
        outer: { duration: { base: "quarter" }, multiple: 2 },
        individualDuration: { base: "quarter" },
        content: [
          { type: "event", id: "a", duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
          { type: "event", id: "b", duration: { base: "half" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
        ],
      },
    ];

    deleteNote(score, { measureIndex: 0, partIndex: 0, voice: 0, eventIndex: 0, tupletIndex: 0 });

    expect(seq(score).content).toHaveLength(2);
    expect(isRest(seq(score).content[0]!)).toBe(true);
    expect(seq(score).content.map((event) => event.duration)).toEqual([{ base: "quarter" }, { base: "quarter" }]);
  });
});

describe("edit transforms", () => {
  it("toggleRestAtLocations is reversible on the same location", () => {
    const score = makeScoreWithQuarterRests();
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    const location = {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    };

    expect(toggleRestAtLocations(score, [location])).toBe(true);
    expect(isRest(contentAt(score, 0))).toBe(true);

    expect(toggleRestAtLocations(score, [location])).toBe(true);
    const restored = contentAt(score, 0);
    expect(isRest(restored)).toBe(false);
    expect(restored.notes?.[0]?.pitch.step).toBe("C");
    expect(restored.notes?.[0]?.pitch.octave).toBe(4);
  });

  it("toggleDotAtLocations toggles dots on and off", () => {
    const score = makeScoreWithQuarterRests();
    const location = {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    };

    expect(toggleDotAtLocations(score, [location])).toBe(true);
    expect(contentAt(score, 0).duration.dots).toBe(1);

    expect(toggleDotAtLocations(score, [location])).toBe(true);
    expect(contentAt(score, 0).duration.dots).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// changePitch
// ═══════════════════════════════════════════

describe("changePitch", () => {
  beforeEach(() => resetIdCounter());

  it("changes the pitch of a note", () => {
    let score = makeScoreWithQuarterRests();
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    score = changePitch(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
      newPitch: { step: "G", octave: 5 },
    });

    expect(contentAt(score, 0).notes![0]!.pitch.step).toBe("G");
    expect(contentAt(score, 0).notes![0]!.pitch.octave).toBe(5);
  });

  it("preserves accidental alteration", () => {
    let score = makeScoreWithQuarterRests();
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    score = changePitch(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
      newPitch: { step: "F", octave: 4, alter: 1 },
    });

    expect(contentAt(score, 0).notes![0]!.pitch.alter).toBe(1);
  });

  it("throws when changing pitch of a rest", () => {
    const score = makeScoreWithQuarterRests();
    expect(() =>
      changePitch(score, {
        measureIndex: 0,
        partIndex: 0,
        voice: 0,
        eventIndex: 0,
        newPitch: { step: "C", octave: 4 },
      }),
    ).toThrow("Cannot change pitch of a rest");
  });
});

// ═══════════════════════════════════════════
// changeDuration
// ═══════════════════════════════════════════

describe("changeDuration", () => {
  beforeEach(() => resetIdCounter());

  it("shortens a note, inserting a rest for the difference", () => {
    const score = makeScoreWithQuarterRests();
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "half" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    changeDuration(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
      newDuration: { base: "quarter" },
    });

    const ev = contentAt(score, 0);
    expect(ev.duration.base).toBe("quarter");
    expect(isRest(ev)).toBe(false);

    // Total beats should still be 4
    let total = 0;
    for (const e of seq(score).content) {
      total += durationToBeats(e.duration);
    }
    expect(total).toBeCloseTo(4);
  });

  it("lengthens a note, consuming following rests", () => {
    const score = makeScoreWithQuarterRests();
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    changeDuration(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
      newDuration: { base: "half" },
    });

    const ev = contentAt(score, 0);
    expect(ev.duration.base).toBe("half");
    expect(isRest(ev)).toBe(false);

    // Total beats should still be 4
    let total = 0;
    for (const e of seq(score).content) {
      total += durationToBeats(e.duration);
    }
    expect(total).toBeCloseTo(4);
  });

  it("does nothing when duration is unchanged", () => {
    const score = makeScoreWithQuarterRests();
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    const contentLenBefore = seq(score).content.length;
    changeDuration(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
      newDuration: { base: "quarter" },
    });

    expect(seq(score).content.length).toBe(contentLenBefore);
    expect(contentAt(score, 0).duration.base).toBe("quarter");
  });
});

// ═══════════════════════════════════════════
// generateEventId
// ═══════════════════════════════════════════

describe("generateEventId", () => {
  beforeEach(() => resetIdCounter());

  it("generates a UUID v7 string", () => {
    const id = generateEventId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generates unique IDs on successive calls", () => {
    const id1 = generateEventId();
    const id2 = generateEventId();
    expect(id1).not.toBe(id2);
  });
});

// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// addSlur
// ═══════════════════════════════════════════

describe("addSlur", () => {
  function makeScoreWithTwoNotes(): Score {
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
                      id: "ev-start",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                    },
                    {
                      type: "event",
                      id: "ev-end",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "E", octave: 4 } }],
                    },
                    { type: "event", duration: { base: "half" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  it("adds a slur from source to target event", () => {
    const score = makeScoreWithTwoNotes();
    addSlur(score, { sourceEventId: "ev-start", targetEventId: "ev-end" });

    const ev = score.parts[0]!.measures[0]!.sequences[0]!.content[0]! as NoteEvent;
    expect(ev.slurs).toBeDefined();
    expect(ev.slurs).toHaveLength(1);
    expect(ev.slurs![0]!.target).toBe("ev-end");
  });

  it("appends to existing slurs array", () => {
    const score = makeScoreWithTwoNotes();
    const startEvent = score.parts[0]!.measures[0]!.sequences[0]!.content[0]! as NoteEvent;
    startEvent.slurs = [{ target: "ev-other" }];

    addSlur(score, { sourceEventId: "ev-start", targetEventId: "ev-end" });

    expect(startEvent.slurs).toHaveLength(2);
    expect(startEvent.slurs![1]!.target).toBe("ev-end");
  });

  it("throws when source event is not found", () => {
    const score = makeScoreWithTwoNotes();
    expect(() => addSlur(score, { sourceEventId: "ev-nonexistent", targetEventId: "ev-end" })).toThrow(
      "Source event ev-nonexistent not found",
    );
  });

  it("throws when target event is not found", () => {
    const score = makeScoreWithTwoNotes();
    expect(() => addSlur(score, { sourceEventId: "ev-start", targetEventId: "ev-missing" })).toThrow(
      "Target event ev-missing not found",
    );
  });

  it("writes advanced slur fields", () => {
    const score = makeScoreWithTwoNotes();
    const startEvent = score.parts[0]!.measures[0]!.sequences[0]!.content[0]! as NoteEvent;
    const endEvent = score.parts[0]!.measures[0]!.sequences[0]!.content[1]! as NoteEvent;
    startEvent.notes![0]!.id = "n-start";
    endEvent.notes![0]!.id = "n-end";

    addSlur(score, {
      sourceEventId: "ev-start",
      targetEventId: "ev-end",
      side: "up",
      sideEnd: "down",
      lineType: "dashed",
      startNote: "n-start",
      endNote: "n-end",
    });

    const slur = startEvent.slurs![0]!;
    expect(slur.side).toBe("up");
    expect(slur.sideEnd).toBe("down");
    expect(slur.lineType).toBe("dashed");
    expect(slur.startNote).toBe("n-start");
    expect(slur.endNote).toBe("n-end");
  });

  it("resolves a grace note as a slur source and target", () => {
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
                    {
                      type: "grace",
                      content: [
                        {
                          type: "event",
                          id: "grace-1",
                          duration: { base: "eighth" },
                          notes: [{ pitch: { step: "D", octave: 5 } }],
                        },
                      ],
                    },
                    {
                      type: "event",
                      id: "principal-1",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 5 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    // Grace note as the source, principal as the target.
    expect(() => addSlur(score, { sourceEventId: "grace-1", targetEventId: "principal-1" })).not.toThrow();
    const graceEv = (score.parts[0]!.measures[0]!.sequences[0]!.content[0] as { content: NoteEvent[] }).content[0]!;
    expect(graceEv.slurs).toHaveLength(1);
    expect(graceEv.slurs![0]!.target).toBe("principal-1");

    // Principal as the source, grace note as the target.
    expect(() => addSlur(score, { sourceEventId: "principal-1", targetEventId: "grace-1" })).not.toThrow();
    const principalEv = score.parts[0]!.measures[0]!.sequences[0]!.content[1]! as NoteEvent;
    expect(principalEv.slurs![0]!.target).toBe("grace-1");
  });

  it("finds source event across multiple measures", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }, {}],
      },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
                },
              ],
            },
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event",
                      id: "ev-m2",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "D", octave: 4 } }],
                    },
                    {
                      type: "event",
                      id: "ev-target",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "E", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    addSlur(score, { sourceEventId: "ev-m2", targetEventId: "ev-target" });

    const ev = score.parts[0]!.measures[1]!.sequences[0]!.content[0]! as NoteEvent;
    expect(ev.slurs).toHaveLength(1);
    expect(ev.slurs![0]!.target).toBe("ev-target");
  });

  it("works when source and target events have no IDs (assigns fresh IDs)", () => {
    const score: Score = {
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
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "C", octave: 4 } }],
                    },
                    {
                      type: "event",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "E", octave: 4 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    // Assign IDs manually (simulating what handleSlurKey does before calling addSlur)
    const events = score.parts[0]!.measures[0]!.sequences[0]!.content as NoteEvent[];
    events[0]!.id = generateEventId();
    events[1]!.id = generateEventId();

    addSlur(score, { sourceEventId: events[0]!.id!, targetEventId: events[1]!.id! });

    const ev = events[0]!;
    expect(ev.slurs).toHaveLength(1);
    expect(ev.slurs![0]!.target).toBe(events[1]!.id);
    // IDs should be UUID v7 strings
    const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(events[0]!.id).toMatch(UUID_V7);
    expect(events[1]!.id).toMatch(UUID_V7);
  });
});

describe("findForwardSlurTargetId (container-aware slur target search)", () => {
  function locOf(eventIndex: number, tupletIndex?: number) {
    return { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex, tupletIndex };
  }

  function scoreWithContent(content: Sequence["content"], secondMeasure?: Sequence["content"]): Score {
    const measures = [{ sequences: [{ content }] }];
    if (secondMeasure) measures.push({ sequences: [{ content: secondMeasure }] });
    return {
      mnx: { version: 1 },
      global: { measures: secondMeasure ? [{ time: { count: 4, unit: 4 } }, {}] : [{ time: { count: 4, unit: 4 } }] },
      parts: [{ name: "Piano", measures }],
    } as Score;
  }

  it("finds a target note inside a grace container (regression: grace was skipped)", () => {
    const score = scoreWithContent([
      { type: "event", id: "src", duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
      {
        type: "grace",
        content: [
          { type: "event", id: "grace-1", duration: { base: "eighth" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
        ],
      },
    ]);
    expect(findForwardSlurTargetId(score, locOf(0))).toBe("grace-1");
  });

  it("finds a target note inside a tremolo container (regression: tremolo was skipped)", () => {
    const score = scoreWithContent([
      { type: "event", id: "src", duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
      {
        type: "tremolo",
        marks: 3,
        outer: { duration: { base: "quarter" }, multiple: 1 },
        content: [
          { type: "event", id: "trem-1", duration: { base: "eighth" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
          { type: "event", id: "trem-2", duration: { base: "eighth" }, notes: [{ pitch: { step: "G", octave: 4 } }] },
        ],
      },
    ]);
    expect(findForwardSlurTargetId(score, locOf(0))).toBe("trem-1");
  });

  it("finds the next note inside the same tuplet before leaving it", () => {
    const score = scoreWithContent([
      {
        type: "tuplet",
        inner: { duration: { base: "eighth" }, multiple: 3 },
        outer: { duration: { base: "quarter" }, multiple: 1 },
        content: [
          { type: "event", id: "t0", duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
          { type: "event", id: "t1", duration: { base: "eighth" }, notes: [{ pitch: { step: "D", octave: 4 } }] },
          { type: "event", id: "t2", duration: { base: "eighth" }, notes: [{ pitch: { step: "E", octave: 4 } }] },
        ],
      },
    ]);
    expect(findForwardSlurTargetId(score, locOf(0, 0))).toBe("t1");
  });

  it("skips rests and falls through to the next measure's same voice", () => {
    const score = scoreWithContent(
      [
        { type: "event", id: "src", duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
        { type: "event", id: "rest", duration: { base: "half" }, rest: {} },
      ],
      [{ type: "event", id: "m2", duration: { base: "quarter" }, notes: [{ pitch: { step: "G", octave: 4 } }] }],
    );
    expect(findForwardSlurTargetId(score, locOf(0))).toBe("m2");
  });

  it("returns null when there is no following note", () => {
    const score = scoreWithContent([
      { type: "event", id: "src", duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
      { type: "event", id: "rest", duration: { base: "half" }, rest: {} },
    ]);
    expect(findForwardSlurTargetId(score, locOf(0))).toBeNull();
  });
});

describe("advanced tie/slur property editing", () => {
  function makeConnectorScore(): Score {
    return {
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
                    {
                      type: "event",
                      id: "ev-1",
                      duration: { base: "quarter" },
                      notes: [{ id: "n-1", pitch: { step: "C", octave: 4 }, ties: [{ target: "n-2" }] }],
                      slurs: [{ target: "ev-2" }],
                    },
                    {
                      type: "event",
                      id: "ev-2",
                      duration: { base: "quarter" },
                      notes: [{ id: "n-2", pitch: { step: "C", octave: 4 } }],
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

  it("updates advanced tie fields and validates target note IDs", () => {
    const score = makeConnectorScore();
    setTieProperties(score, {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      noteIndex: 0,
      tieIndex: 0,
      targetType: "crossVoice",
      side: "up",
      lv: true,
    });
    const tie = (score.parts[0]!.measures[0]!.sequences[0]!.content[0]! as NoteEvent).notes![0]!.ties![0]!;
    expect(tie.targetType).toBe("crossVoice");
    expect(tie.side).toBe("up");
    expect(tie.lv).toBe(true);
    expect(tie.target).toBeUndefined();

    expect(() =>
      setTieProperties(score, {
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 0,
        eventIndex: 0,
        noteIndex: 0,
        tieIndex: 0,
        target: "missing-note",
      }),
    ).toThrow("Tie target note missing-note not found");
  });

  it("updates advanced slur fields and validates references", () => {
    const score = makeConnectorScore();
    setSlurProperties(score, {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      slurIndex: 0,
      target: "ev-2",
      side: "down",
      sideEnd: "up",
      lineType: "dashed",
      startNote: "n-1",
      endNote: "n-2",
    });

    const slur = (score.parts[0]!.measures[0]!.sequences[0]!.content[0]! as NoteEvent).slurs![0]!;
    expect(slur.side).toBe("down");
    expect(slur.sideEnd).toBe("up");
    expect(slur.lineType).toBe("dashed");
    expect(slur.startNote).toBe("n-1");
    expect(slur.endNote).toBe("n-2");

    expect(() =>
      setSlurProperties(score, {
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 0,
        eventIndex: 0,
        slurIndex: 0,
        target: "missing-event",
      }),
    ).toThrow("Slur target event missing-event not found");
  });
});

// ═══════════════════════════════════════════
// accidentalDisplay helpers
// ═══════════════════════════════════════════

describe("accidentalDisplay helpers", () => {
  function makeScoreWithSingleNote(): Score {
    return {
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
                    {
                      type: "event",
                      id: "ev-1",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { step: "F", octave: 4, alter: 1 } }],
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

  it("sets show/force/enclosure on a note accidentalDisplay", () => {
    const score = makeScoreWithSingleNote();

    setNoteAccidentalDisplay(score, {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      show: true,
      force: true,
      enclosureSymbol: "parentheses",
    });

    const note = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!;
    expect(note.accidentalDisplay).toEqual({
      show: true,
      force: true,
      enclosure: { symbol: "parentheses" },
    });
    expect(note.pitch.alter).toBe(1);
  });

  it("clears enclosure without changing pitch accidental", () => {
    const score = makeScoreWithSingleNote();
    setNoteAccidentalDisplay(score, {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      show: true,
      enclosureSymbol: "brackets",
    });

    setNoteAccidentalDisplay(score, {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      enclosureSymbol: null,
    });

    const note = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!;
    expect(note.accidentalDisplay).toEqual({ show: true });
    expect(note.pitch.alter).toBe(1);
  });

  it("toggles courtesy accidental force mode", () => {
    const score = makeScoreWithSingleNote();

    toggleCourtesyAccidental(score, {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    });
    let note = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!;
    expect(note.accidentalDisplay).toEqual({ show: true, force: true });

    toggleCourtesyAccidental(score, {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
    });
    note = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!;
    expect(note.accidentalDisplay).toEqual({ show: true });
    expect(note.pitch.alter).toBe(1);
  });
});

// ═══════════════════════════════════════════
// backspaceInNoteInput
// ═══════════════════════════════════════════

describe("backspaceInNoteInput", () => {
  beforeEach(() => resetIdCounter());

  it("deletes the last note in a sequence", () => {
    const score = makeScoreWithQuarterRests();
    // Add a note at beat 0
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    // Verify note is there
    expect(isRest(contentAt(score, 0))).toBe(false);

    const result = backspaceInNoteInput(score, 0, 0);
    expect(result).toBe(true);

    // Sequence should now be empty (note + trailing rests removed)
    expect(seq(score).content.length).toBe(0);
  });

  it("removes only the last note, keeping prior content", () => {
    const score = makeScoreWithQuarterRests();
    // Add two notes
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });
    addNote(score, {
      pitch: { step: "D", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1,
    });

    const result = backspaceInNoteInput(score, 0, 0);
    expect(result).toBe(true);

    // Should have just the first note remaining
    const s = seq(score);
    expect(s.content.length).toBe(1);
    expect(isRest(s.content[0]!)).toBe(false);
    expect(s.content[0]!.notes![0]!.pitch.step).toBe("C");
  });

  it("skips trailing rests to find the last note", () => {
    const score = makeEmptyScore({ count: 4, unit: 4 });
    // Add a note at beat 0 (will have trailing rests)
    addNote(score, {
      pitch: { step: "E", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    // Sequence: [note, rests...]
    expect(seq(score).content.length).toBeGreaterThan(1);

    const result = backspaceInNoteInput(score, 0, 0);
    expect(result).toBe(true);

    // All content should be removed (note replaced with rest, then trailing rests stripped)
    expect(seq(score).content.length).toBe(0);
  });

  it("returns false when no notes exist", () => {
    const score = makeEmptyScore({ count: 4, unit: 4 });
    // Only rests in the measure
    const result = backspaceInNoteInput(score, 0, 0);
    expect(result).toBe(false);

    // Content unchanged
    expect(seq(score).content.length).toBe(1);
    expect(isRest(seq(score).content[0]!)).toBe(true);
  });

  it("successive backspaces delete notes in reverse order", () => {
    const score = makeScoreWithQuarterRests();
    // Add three notes
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });
    addNote(score, {
      pitch: { step: "D", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1,
    });
    addNote(score, {
      pitch: { step: "E", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2,
    });

    // First backspace: remove E
    backspaceInNoteInput(score, 0, 0);
    expect(seq(score).content.length).toBe(2);
    expect(seq(score).content[1]!.notes![0]!.pitch.step).toBe("D");

    // Second backspace: remove D
    backspaceInNoteInput(score, 0, 0);
    expect(seq(score).content.length).toBe(1);
    expect(seq(score).content[0]!.notes![0]!.pitch.step).toBe("C");

    // Third backspace: remove C
    backspaceInNoteInput(score, 0, 0);
    expect(seq(score).content.length).toBe(0);
  });

  it("works across measures", () => {
    // Create a 2-measure score
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 4, unit: 4 } }, {}],
      },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
                },
              ],
            },
            {
              sequences: [
                {
                  content: [{ type: "event", duration: { base: "whole" }, rest: {} }],
                },
              ],
            },
          ],
        },
      ],
    };

    // Add a note in measure 1 (index 0)
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "whole" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    // Measure 0 should have the note, measure 1 still rests
    expect(isRest(score.parts[0]!.measures[0]!.sequences[0]!.content[0]!)).toBe(false);

    // Backspace should find the note in measure 0 (measure 1 has only rests)
    const result = backspaceInNoteInput(score, 0, 0);
    expect(result).toBe(true);

    // Measure 0 content should be empty
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content.length).toBe(0);
  });

  it("returns false for invalid part index", () => {
    const score = makeEmptyScore({ count: 4, unit: 4 });
    expect(backspaceInNoteInput(score, 5, 0)).toBe(false);
  });
});

// ═══════════════════════════════════════════
// getEffectiveTimeSignature
// ═══════════════════════════════════════════

describe("getEffectiveTimeSignature", () => {
  it("returns the time signature declared on the measure", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 3, unit: 4 } }] },
      parts: [{ name: "P", measures: [{ sequences: [] }] }],
    };
    expect(getEffectiveTimeSignature(score, 0)).toEqual({
      count: 3,
      unit: 4,
    });
  });

  it("inherits time signature from previous measures", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 3, unit: 4 } }, {}] },
      parts: [{ name: "P", measures: [{ sequences: [] }, { sequences: [] }] }],
    };
    expect(getEffectiveTimeSignature(score, 1)).toEqual({
      count: 3,
      unit: 4,
    });
  });

  it("defaults to 4/4 if no time signature found", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{}] },
      parts: [{ name: "P", measures: [{ sequences: [] }] }],
    };
    expect(getEffectiveTimeSignature(score, 0)).toEqual({
      count: 4,
      unit: 4,
    });
  });
});

// ═══════════════════════════════════════════
// addNoteWithAutoTie
// ═══════════════════════════════════════════

function makeTwoMeasureScore(timeSig: { count: number; unit: number }): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: timeSig }, {}] },
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

function seqAt(score: Score, measureIdx: number, partIdx = 0, voice = 0): Sequence {
  return score.parts[partIdx]!.measures[measureIdx]!.sequences[voice]!;
}

describe("addNoteWithAutoTie", () => {
  it("materializes a 5/2 bar rest before inserting a quarter note", () => {
    const score = makeEmptyScore({ count: 5, unit: 2 });
    const sequence = score.parts[0]!.measures[0]!.sequences[0]!;
    sequence.content = [];
    sequence.fullMeasure = { visualDuration: { base: "whole" } };

    addNoteWithAutoTie(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    expect(sequence.fullMeasure).toBeUndefined();
    expect(sequence.content[0]).toMatchObject({
      type: "event",
      duration: { base: "quarter" },
      notes: [{ pitch: { step: "C", octave: 4 } }],
    });
    expect(sequence.content[0]!.id).toBeTruthy();
    expect(sequence.content.reduce((beats, item) => beats + sequenceContentBeats(item), 0)).toBe(10);
    expect(sequence.content.slice(1).every((item) => isRest(item))).toBe(true);
  });

  beforeEach(() => resetIdCounter());

  it("delegates to addNote when note fits within the measure", () => {
    const score = makeTwoMeasureScore({ count: 4, unit: 4 });
    const result = addNoteWithAutoTie(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    const s = seqAt(result, 0);
    expect(isRest(s.content[0]!)).toBe(false);
    expect(s.content[0]!.notes![0]!.pitch.step).toBe("C");
    expect(s.content[0]!.duration.base).toBe("quarter");
  });

  it("splits half note at beat 3 of 4/4 into tied quarter + quarter", () => {
    const score = makeTwoMeasureScore({ count: 4, unit: 4 });
    addNoteWithAutoTie(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "half" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 3,
    });

    // Measure 0: should have a quarter note at beat 3 (with tie)
    const s0 = seqAt(score, 0);
    const noteEvents0 = s0.content.filter((e) => !isRest(e));
    expect(noteEvents0.length).toBe(1);
    expect(noteEvents0[0]!.duration.base).toBe("quarter");
    expect(noteEvents0[0]!.notes![0]!.ties).toBeDefined();
    expect(noteEvents0[0]!.notes![0]!.ties!.length).toBe(1);

    // Measure 1: should have a quarter note at beat 0 (no tie)
    const s1 = seqAt(score, 1);
    const noteEvents1 = s1.content.filter((e) => !isRest(e));
    expect(noteEvents1.length).toBe(1);
    expect(noteEvents1[0]!.duration.base).toBe("quarter");
    expect(noteEvents1[0]!.notes![0]!.ties).toBeUndefined();

    // Tie target should match second note's ID
    const tieTarget = noteEvents0[0]!.notes![0]!.ties![0]!.target;
    const secondNoteId = noteEvents1[0]!.notes![0]!.id;
    expect(tieTarget).toBe(secondNoteId);
  });

  it("splits whole note at beat 2 of 4/4 into half + half tied", () => {
    const score = makeTwoMeasureScore({ count: 4, unit: 4 });
    addNoteWithAutoTie(score, {
      pitch: { step: "E", octave: 4 },
      duration: { base: "whole" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2,
    });

    // Measure 0: half note at beat 2 (tied)
    const s0 = seqAt(score, 0);
    const notes0 = s0.content.filter((e) => !isRest(e));
    expect(notes0.length).toBe(1);
    expect(notes0[0]!.duration.base).toBe("half");
    expect(notes0[0]!.notes![0]!.ties).toBeDefined();

    // Measure 1: half note at beat 0 (no tie, last in chain)
    const s1 = seqAt(score, 1);
    const notes1 = s1.content.filter((e) => !isRest(e));
    expect(notes1.length).toBe(1);
    expect(notes1[0]!.duration.base).toBe("half");
    expect(notes1[0]!.notes![0]!.ties).toBeUndefined();
  });

  it("handles 3-beat overflow decomposing into dotted half", () => {
    const score = makeTwoMeasureScore({ count: 4, unit: 4 });
    // Whole note (4 beats) at beat 1 → 3 remaining in measure, 1 overflow
    // First fragment: 3 beats → dotted half (tied)
    // Second fragment: 1 beat → quarter
    addNoteWithAutoTie(score, {
      pitch: { step: "G", octave: 4 },
      duration: { base: "whole" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1,
    });

    // Measure 0: dotted half (tied to next measure)
    const s0 = seqAt(score, 0);
    const notes0 = s0.content.filter((e) => !isRest(e));
    expect(notes0.length).toBe(1);
    expect(notes0[0]!.duration.base).toBe("half");
    expect(notes0[0]!.duration.dots).toBe(1);
    expect(notes0[0]!.notes![0]!.ties).toBeDefined();

    // Measure 1: quarter at beat 0 (no tie)
    const s1 = seqAt(score, 1);
    const notes1 = s1.content.filter((e) => !isRest(e));
    expect(notes1.length).toBe(1);
    expect(notes1[0]!.duration.base).toBe("quarter");
    expect(notes1[0]!.notes![0]!.ties).toBeUndefined();

    // Verify tie chain: note0 → note1
    const id0Target = notes0[0]!.notes![0]!.ties![0]!.target;
    const id1 = notes1[0]!.notes![0]!.id;
    expect(id0Target).toBe(id1);
  });

  it("auto-appends measure when overflow extends beyond existing measures", () => {
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

    // Only 1 measure exists — half note at beat 3 needs measure 1
    const result = addNoteWithAutoTie(score, {
      pitch: { step: "D", octave: 5 },
      duration: { base: "half" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 3,
    });

    // A new measure should have been auto-appended
    expect(result.global.measures.length).toBe(2);
    expect(result.parts[0]!.measures.length).toBe(2);

    // Verify the notes
    const s0 = seqAt(result, 0);
    const notes0 = s0.content.filter((e) => !isRest(e));
    expect(notes0.length).toBe(1);
    expect(notes0[0]!.notes![0]!.ties).toBeDefined();

    const s1 = seqAt(result, 1);
    const notes1 = s1.content.filter((e) => !isRest(e));
    expect(notes1.length).toBe(1);
    expect(notes1[0]!.notes![0]!.ties).toBeUndefined();
  });

  it("works with 3/4 time signature", () => {
    const score = makeTwoMeasureScore({ count: 3, unit: 4 });
    // 3/4: 3 beats per measure. Half note at beat 2 → 1 remaining, 1 overflow
    addNoteWithAutoTie(score, {
      pitch: { step: "A", octave: 4 },
      duration: { base: "half" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2,
    });

    // Measure 0: quarter note at beat 2 (tied)
    const s0 = seqAt(score, 0);
    const notes0 = s0.content.filter((e) => !isRest(e));
    expect(notes0.length).toBe(1);
    expect(notes0[0]!.duration.base).toBe("quarter");
    expect(notes0[0]!.notes![0]!.ties).toBeDefined();

    // Measure 1: quarter note at beat 0 (no tie)
    const s1 = seqAt(score, 1);
    const notes1 = s1.content.filter((e) => !isRest(e));
    expect(notes1.length).toBe(1);
    expect(notes1[0]!.duration.base).toBe("quarter");
    expect(notes1[0]!.notes![0]!.ties).toBeUndefined();
  });

  it("handles multi-measure overflow", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [{ time: { count: 2, unit: 4 } }, {}, {}],
      },
      parts: [
        {
          name: "Piano",
          measures: [
            {
              sequences: [
                {
                  content: [{ type: "event", duration: { base: "half" }, rest: {} }],
                },
              ],
            },
            {
              sequences: [
                {
                  content: [{ type: "event", duration: { base: "half" }, rest: {} }],
                  fullMeasure: { visualDuration: { base: "whole" } },
                },
              ],
            },
            {
              sequences: [
                {
                  content: [{ type: "event", duration: { base: "half" }, rest: {} }],
                  fullMeasure: { visualDuration: { base: "whole" } },
                },
              ],
            },
          ],
        },
      ],
    };

    // 2/4: 2 beats per measure. Whole note (4 beats) at beat 1 → 1 remaining, 3 overflow
    // Fragment 0: 1 beat in m0
    // Fragment 1: 2 beats in m1
    // Fragment 2: 1 beat in m2
    addNoteWithAutoTie(score, {
      pitch: { step: "F", octave: 4 },
      duration: { base: "whole" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1,
    });

    // Measure 0: quarter at beat 1 (tied)
    const notes0 = seqAt(score, 0).content.filter((e) => !isRest(e));
    expect(notes0.length).toBe(1);
    expect(notes0[0]!.duration.base).toBe("quarter");
    expect(notes0[0]!.notes![0]!.ties).toBeDefined();

    // Measure 1: half at beat 0 (tied)
    const notes1 = seqAt(score, 1).content.filter((e) => !isRest(e));
    expect(notes1.length).toBe(1);
    expect(notes1[0]!.duration.base).toBe("half");
    expect(notes1[0]!.notes![0]!.ties).toBeDefined();

    // Measure 2: quarter at beat 0 (no tie)
    const notes2 = seqAt(score, 2).content.filter((e) => !isRest(e));
    expect(notes2.length).toBe(1);
    expect(notes2[0]!.duration.base).toBe("quarter");
    expect(notes2[0]!.notes![0]!.ties).toBeUndefined();
  });

  it("preserves pitch across all tied fragments", () => {
    const score = makeTwoMeasureScore({ count: 4, unit: 4 });
    addNoteWithAutoTie(score, {
      pitch: { step: "B", octave: 3, alter: -1 },
      duration: { base: "half" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 3,
    });

    const note0 = seqAt(score, 0).content.find((e) => !isRest(e))!;
    const note1 = seqAt(score, 1).content.find((e) => !isRest(e))!;

    expect(note0.notes![0]!.pitch).toEqual({
      step: "B",
      octave: 3,
      alter: -1,
    });
    expect(note1.notes![0]!.pitch).toEqual({
      step: "B",
      octave: 3,
      alter: -1,
    });
  });

  it("preserves measure beats (rests fill remaining space)", () => {
    const score = makeTwoMeasureScore({ count: 4, unit: 4 });
    addNoteWithAutoTie(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "half" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 3,
    });

    // Measure 0 total beats should be 4
    let total0 = 0;
    for (const ev of seqAt(score, 0).content) {
      total0 += durationToBeats(ev.duration);
    }
    expect(total0).toBeCloseTo(4);

    // Measure 1 total beats should be 4
    let total1 = 0;
    for (const ev of seqAt(score, 1).content) {
      total1 += durationToBeats(ev.duration);
    }
    expect(total1).toBeCloseTo(4);
  });
});

// ═══════════════════════════════════════════
// addPitchToChord
// ═══════════════════════════════════════════

describe("addPitchToChord", () => {
  beforeEach(() => resetIdCounter());

  it("adds a pitch to an existing note event to form a chord", () => {
    const score = makeScoreWithQuarterRests();
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    addPitchToChord(score, {
      pitch: { step: "E", octave: 4 },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
    });

    const event = contentAt(score, 0);
    expect(event.notes!.length).toBe(2);
    expect(event.notes![0]!.pitch.step).toBe("C");
    expect(event.notes![1]!.pitch.step).toBe("E");
  });

  it("skips duplicate pitches", () => {
    const score = makeScoreWithQuarterRests();
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    addPitchToChord(score, {
      pitch: { step: "C", octave: 4 },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
    });

    const event = contentAt(score, 0);
    expect(event.notes!.length).toBe(1);
  });

  it("treats same step but different octave as distinct", () => {
    const score = makeScoreWithQuarterRests();
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    addPitchToChord(score, {
      pitch: { step: "C", octave: 5 },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
    });

    const event = contentAt(score, 0);
    expect(event.notes!.length).toBe(2);
    expect(event.notes![0]!.pitch.octave).toBe(4);
    expect(event.notes![1]!.pitch.octave).toBe(5);
  });

  it("converts a rest to a note event", () => {
    const score = makeScoreWithQuarterRests();

    addPitchToChord(score, {
      pitch: { step: "G", octave: 4 },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
    });

    const event = contentAt(score, 0);
    expect(isRest(event)).toBe(false);
    expect(event.notes!.length).toBe(1);
    expect(event.notes![0]!.pitch.step).toBe("G");
    expect(event.duration.base).toBe("quarter");
  });

  it("preserves the existing event duration", () => {
    const score = makeEmptyScore({ count: 4, unit: 4 });
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "half" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    addPitchToChord(score, {
      pitch: { step: "E", octave: 4 },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
    });

    const event = contentAt(score, 0);
    expect(event.duration.base).toBe("half");
    expect(event.notes!.length).toBe(2);
  });

  it("builds a three-note chord", () => {
    const score = makeScoreWithQuarterRests();
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    addPitchToChord(score, {
      pitch: { step: "E", octave: 4 },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
    });
    addPitchToChord(score, {
      pitch: { step: "G", octave: 4 },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
    });

    const event = contentAt(score, 0);
    expect(event.notes!.length).toBe(3);
    expect(event.notes!.map((n) => n.pitch.step)).toEqual(["C", "E", "G"]);
  });

  it("handles accidentals when checking for duplicates", () => {
    const score = makeScoreWithQuarterRests();
    addNote(score, {
      pitch: { step: "F", octave: 4, alter: 1 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    // F natural is not a duplicate of F#
    addPitchToChord(score, {
      pitch: { step: "F", octave: 4 },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
    });

    expect(contentAt(score, 0).notes!.length).toBe(2);

    // F# is a duplicate
    addPitchToChord(score, {
      pitch: { step: "F", octave: 4, alter: 1 },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
    });

    expect(contentAt(score, 0).notes!.length).toBe(2);
  });

  it("throws on invalid event index", () => {
    const score = makeEmptyScore({ count: 4, unit: 4 });
    expect(() =>
      addPitchToChord(score, {
        pitch: { step: "C", octave: 4 },
        measureIndex: 0,
        partIndex: 0,
        voice: 0,
        eventIndex: 99,
      }),
    ).toThrow("Event 99 not found");
  });
});

// ═══════════════════════════════════════════
// findLastNoteEvent
// ═══════════════════════════════════════════

describe("findLastNoteEvent", () => {
  beforeEach(() => resetIdCounter());

  it("returns null when all events are rests", () => {
    const score = makeScoreWithQuarterRests();
    expect(findLastNoteEvent(score, 0, 0)).toBeNull();
  });

  it("finds the last note in the first measure", () => {
    const score = makeScoreWithQuarterRests();
    addNote(score, {
      pitch: { step: "C", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });
    addNote(score, {
      pitch: { step: "D", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1,
    });

    const loc = findLastNoteEvent(score, 0, 0);
    expect(loc).not.toBeNull();
    expect(loc!.measureIndex).toBe(0);
    expect(loc!.eventIndex).toBe(1);
  });

  it("returns null for non-existent part", () => {
    const score = makeScoreWithQuarterRests();
    expect(findLastNoteEvent(score, 5, 0)).toBeNull();
  });

  it("returns null for non-existent voice", () => {
    const score = makeScoreWithQuarterRests();
    expect(findLastNoteEvent(score, 0, 3)).toBeNull();
  });
});
