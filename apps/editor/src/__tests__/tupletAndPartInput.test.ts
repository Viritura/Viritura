import { describe, it, expect } from "vitest";
import { resolveEventLocation, getEventAtLocation, getContentArrayForLocation } from "../score/ElementPath";
import { addNote, sequenceContentBeats } from "../commands/noteCommands";
import { createTupletFromEvent } from "../commands/tupletCommands";
import {
  computeUsedBeats,
  computeEndOfContentCursor,
  moveCursorToNextEvent,
  moveCursorToPreviousEvent,
} from "../commands/cursorCommands";
import type { Score, Tuplet, NoteEvent } from "@viritura/core";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Regression tests for tuplet note input and multi-part click targeting.
 *
 * These test fixes for:
 * 1. resolveEventLocation not finding events inside tuplets
 * 2. addNote not working on rests inside tuplets
 * 3. handleNoteInputClick hardcoding partIndex = 0
 */

function makeScoreWithTuplet(): Score {
  const score: Score = {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Test",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    id: "ev1",
                    duration: { base: "quarter" },
                    notes: [{ pitch: { octave: 4, step: "C" } }],
                  },
                  { type: "event", id: "ev2", duration: { base: "quarter" }, rest: {} },
                  { type: "event", id: "ev3", duration: { base: "quarter" }, rest: {} },
                  { type: "event", id: "ev4", duration: { base: "quarter" }, rest: {} },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as Score;

  // Convert ev2 (quarter rest) into a triplet of 3 eighth rests
  createTupletFromEvent(score, {
    measureIndex: 0,
    partIndex: 0,
    voice: 0,
    eventIndex: 1,
    tupletNumber: 3,
  });

  return score;
}

function makeMultiPartScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Flute",
        measures: [
          {
            sequences: [{ content: [{ type: "event", id: "fl-ev1", duration: { base: "whole" }, rest: {} }] }],
          },
        ],
      },
      {
        name: "Oboe",
        measures: [
          {
            sequences: [{ content: [{ type: "event", id: "ob-ev1", duration: { base: "whole" }, rest: {} }] }],
          },
        ],
      },
      {
        name: "Clarinet",
        measures: [
          {
            sequences: [{ content: [{ type: "event", id: "cl-ev1", duration: { base: "whole" }, rest: {} }] }],
          },
        ],
      },
    ],
  } as unknown as Score;
}

// ═══════════════════════════════════════════
// resolveEventLocation — tuplet event resolution
// ═══════════════════════════════════════════

describe("resolveEventLocation with tuplets", () => {
  it("finds top-level events by ID", () => {
    const score = makeScoreWithTuplet();
    const loc = resolveEventLocation("p0/m0/s0/ev1", score);
    expect(loc).not.toBeNull();
    expect(loc!.partIndex).toBe(0);
    expect(loc!.eventIndex).toBe(0);
    expect(loc!.tupletIndex).toBeUndefined();
  });

  it("finds events inside a tuplet by ID", () => {
    const score = makeScoreWithTuplet();
    // The tuplet replaced ev2 at index 1. The tuplet's inner events have auto-generated IDs.
    const tuplet = score.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    expect(tuplet.type).toBe("tuplet");
    const innerEvents = (tuplet as Tuplet).content;
    expect(innerEvents.length).toBe(3);

    // Get the ID of the first inner event
    const innerEventId = (innerEvents[0] as NoteEvent).id;
    expect(innerEventId).toBeTruthy();

    const loc = resolveEventLocation(`p0/m0/s0/${innerEventId}`, score);
    expect(loc).not.toBeNull();
    expect(loc!.tupletIndex).toBe(1); // tuplet is at index 1 in the sequence
    expect(loc!.eventIndex).toBe(0); // first event inside the tuplet
  });

  it("finds second and third events inside a tuplet", () => {
    const score = makeScoreWithTuplet();
    const tuplet = score.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    const innerEvents = (tuplet as Tuplet).content;

    for (let i = 0; i < 3; i++) {
      const id = (innerEvents[i] as NoteEvent).id;
      const loc = resolveEventLocation(`p0/m0/s0/${id}`, score);
      expect(loc).not.toBeNull();
      expect(loc!.tupletIndex).toBe(1);
      expect(loc!.eventIndex).toBe(i);
    }
  });

  it("resolves flattened auto-index format inside tuplets", () => {
    const score = makeScoreWithTuplet();
    // Flattened index: ev1=0, tuplet inner[0]=1, inner[1]=2, inner[2]=3, ev3=4, ev4=5
    const loc = resolveEventLocation("p0/m0/s0/__auto_m0_v0_e1", score);
    expect(loc).not.toBeNull();
    expect(loc!.tupletIndex).toBe(1);
    expect(loc!.eventIndex).toBe(0);
  });
});

// ═══════════════════════════════════════════
// getEventAtLocation / getContentArrayForLocation
// ═══════════════════════════════════════════

describe("getEventAtLocation with tuplets", () => {
  it("returns top-level event", () => {
    const score = makeScoreWithTuplet();
    const ev = getEventAtLocation(score, { partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 });
    expect(ev).not.toBeNull();
    expect((ev as NoteEvent).id).toBe("ev1");
  });

  it("returns event inside tuplet", () => {
    const score = makeScoreWithTuplet();
    const tuplet = score.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    const innerId = ((tuplet as Tuplet).content[0] as NoteEvent).id;

    const ev = getEventAtLocation(score, {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      tupletIndex: 1,
    });
    expect(ev).not.toBeNull();
    expect((ev as NoteEvent).id).toBe(innerId);
  });

  it("getContentArrayForLocation returns tuplet content array", () => {
    const score = makeScoreWithTuplet();
    const content = getContentArrayForLocation(score, {
      partIndex: 0,
      measureIndex: 0,
      sequenceIndex: 0,
      eventIndex: 0,
      tupletIndex: 1,
    });
    expect(content).not.toBeNull();
    expect(content!.length).toBe(3); // triplet has 3 inner events
  });
});

// ═══════════════════════════════════════════
// addNote — inside tuplets
// ═══════════════════════════════════════════

describe("addNote inside tuplets", () => {
  it("replaces a rest inside a tuplet with a note", () => {
    const score = makeScoreWithTuplet();

    // The tuplet starts at beat 1 (after the quarter note ev1).
    // Each tuplet eighth in time of 2 quarter = each inner event occupies 1/3 of a beat.
    // Inner event beats: 0.5 each (eighths), scaled by 2/3 = 1/3 beat each.
    // So tuplet inner events are at beats: 1.0, 1.333..., 1.666...

    addNote(score, {
      pitch: { step: "D", octave: 4 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1.0, // first event inside the tuplet
    });

    // The first inner event should now be a note, not a rest
    const tuplet = score.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    expect(tuplet.type).toBe("tuplet");
    const inner = (tuplet as Tuplet).content;
    expect(inner[0].type).toBe("event");
    expect((inner[0] as NoteEvent).notes).toBeDefined();
    expect((inner[0] as NoteEvent).notes![0].pitch.step).toBe("D");
    // Other slots should still be rests
    expect(inner[1].rest).toBeDefined();
    expect(inner[2].rest).toBeDefined();
  });

  it("preserves tuplet structure when adding notes", () => {
    const score = makeScoreWithTuplet();

    addNote(score, {
      pitch: { step: "E", octave: 4 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1.0,
    });

    // Content should still have: ev1, tuplet, ev3, ev4
    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content.length).toBe(4);
    expect(content[0]!.type).toBe("event");
    expect(content[1]!.type).toBe("tuplet");
    expect(content[2]!.type).toBe("event");
    expect(content[3]!.type).toBe("event");
  });
});

// ═══════════════════════════════════════════
// handleNoteInputClick — multi-part targeting
// ═══════════════════════════════════════════

describe("handleNoteInputClick partIndex", () => {
  it("does not hardcode partIndex = 0 in source code", () => {
    const source = readFileSync(resolve(__dirname, "../components/ScoreCanvas/noteInputClickHandler.ts"), "utf-8");

    // Find the addNoteAtClick function (handleNoteInputClick delegates to it)
    const fnStart = source.indexOf("function addNoteAtClick");
    expect(fnStart).toBeGreaterThan(-1);

    // Extract a reasonable chunk of the function (first 2000 chars)
    const fnBody = source.slice(fnStart, fnStart + 2000);

    // Should NOT have "const partIndex = 0" hardcoded
    expect(fnBody).not.toContain("const partIndex = 0");

    // Should use partIndex variable (declared via let)
    expect(fnBody).toContain("let partIndex");
  });

  it("does not hardcode partIndex = 0 in buildBeatMap", () => {
    const source = readFileSync(resolve(__dirname, "../components/inputCursorHelpers.ts"), "utf-8");

    const fnStart = source.indexOf("function buildBeatMap");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = source.slice(fnStart, fnStart + 500);

    // Should NOT have "const partIndex = 0"
    expect(fnBody).not.toContain("const partIndex = 0");

    // Should accept partIndex as a parameter
    expect(fnBody).toContain("partIndex");
  });

  it("resolveEventLocation works for different parts", () => {
    const score = makeMultiPartScore();

    const fluteLoc = resolveEventLocation("p0/m0/s0/fl-ev1", score);
    expect(fluteLoc).not.toBeNull();
    expect(fluteLoc!.partIndex).toBe(0);

    const oboeLoc = resolveEventLocation("p1/m0/s0/ob-ev1", score);
    expect(oboeLoc).not.toBeNull();
    expect(oboeLoc!.partIndex).toBe(1);

    const clarinetLoc = resolveEventLocation("p2/m0/s0/cl-ev1", score);
    expect(clarinetLoc).not.toBeNull();
    expect(clarinetLoc!.partIndex).toBe(2);
  });

  it("addNote works on different parts", () => {
    const score = makeMultiPartScore();

    // Add note to part 1 (oboe)
    addNote(score, {
      pitch: { step: "A", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 1,
      voice: 0,
      beatPosition: 0,
    });

    // Oboe should have a note
    const oboeContent = score.parts[1]!.measures[0]!.sequences[0]!.content;
    expect(oboeContent[0]!.type).toBe("event");
    expect((oboeContent[0] as NoteEvent).notes![0].pitch.step).toBe("A");

    // Flute should be unchanged
    const fluteContent = score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect((fluteContent[0] as NoteEvent).rest).toBeDefined();
  });
});

// ═══════════════════════════════════════════
// addNote — triplet off-by-one regression
// ═══════════════════════════════════════════

describe("addNote triplet off-by-one", () => {
  it("places note at second triplet position (beat 1.333)", () => {
    const score = makeScoreWithTuplet();
    // Triplet starts at beat 1.0. Inner eighth notes scaled by 2/3:
    //   event 0: beat 1.0
    //   event 1: beat 1.333...
    //   event 2: beat 1.666...
    const secondBeat = 1 + 1 / 3;

    addNote(score, {
      pitch: { step: "E", octave: 4 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: secondBeat,
    });

    const tuplet = score.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    const inner = (tuplet as Tuplet).content;
    // First slot should still be a rest
    expect((inner[0] as NoteEvent).rest).toBeDefined();
    // Second slot should be the new note
    expect((inner[1] as NoteEvent).notes).toBeDefined();
    expect((inner[1] as NoteEvent).notes![0].pitch.step).toBe("E");
    // Third slot should still be a rest
    expect((inner[2] as NoteEvent).rest).toBeDefined();
  });

  it("places note at third triplet position (beat 1.666)", () => {
    const score = makeScoreWithTuplet();
    const thirdBeat = 1 + 2 / 3;

    addNote(score, {
      pitch: { step: "F", octave: 4 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: thirdBeat,
    });

    const tuplet = score.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    const inner = (tuplet as Tuplet).content;
    // First and second slots should still be rests
    expect((inner[0] as NoteEvent).rest).toBeDefined();
    expect((inner[1] as NoteEvent).rest).toBeDefined();
    // Third slot should be the new note
    expect((inner[2] as NoteEvent).notes).toBeDefined();
    expect((inner[2] as NoteEvent).notes![0].pitch.step).toBe("F");
  });

  it("places all three triplet notes sequentially", () => {
    const score = makeScoreWithTuplet();
    const beat1 = 1.0;
    const beat2 = 1 + 1 / 3;
    const beat3 = 1 + 2 / 3;

    // Place first triplet note
    addNote(score, {
      pitch: { step: "C", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: beat1,
    });

    // Place second triplet note
    addNote(score, {
      pitch: { step: "D", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: beat2,
    });

    // Place third triplet note
    addNote(score, {
      pitch: { step: "E", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: beat3,
    });

    const tuplet = score.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    expect(tuplet.type).toBe("tuplet");
    const inner = (tuplet as Tuplet).content;
    expect(inner.length).toBe(3);
    expect((inner[0] as NoteEvent).notes![0].pitch.step).toBe("C");
    expect((inner[1] as NoteEvent).notes![0].pitch.step).toBe("D");
    expect((inner[2] as NoteEvent).notes![0].pitch.step).toBe("E");
  });

  it("places note after tuplet at beat 2.0", () => {
    const score = makeScoreWithTuplet();

    // Fill all three triplet slots first
    addNote(score, {
      pitch: { step: "C", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1.0,
    });
    addNote(score, {
      pitch: { step: "D", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1 + 1 / 3,
    });
    addNote(score, {
      pitch: { step: "E", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1 + 2 / 3,
    });

    // Now place a note at beat 2.0 (right after the tuplet)
    addNote(score, {
      pitch: { step: "F", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2.0,
    });

    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    // Should have: quarter note, tuplet, quarter note (F5), quarter rest
    expect(content.length).toBe(4);
    expect(content[0]!.type).toBe("event");
    expect(content[1]!.type).toBe("tuplet");
    expect(content[2]!.type).toBe("event");
    expect((content[2] as NoteEvent).notes![0].pitch.step).toBe("F");
  });

  it("places note at beat 3.0 (past tuplet)", () => {
    const score = makeScoreWithTuplet();

    // Place a note at beat 3.0 (the last beat) without touching the tuplet
    addNote(score, {
      pitch: { step: "G", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 3.0,
    });

    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    // Should have: quarter note, tuplet, quarter rest, quarter note (G4)
    expect(content.length).toBe(4);
    expect(content[3]!.type).toBe("event");
    expect((content[3] as NoteEvent).notes![0].pitch.step).toBe("G");
  });

  it("handles snap-grid rounded beat values for triplets", () => {
    const score = makeScoreWithTuplet();
    // Simulate what buildSnapGrid does: Math.round(beat * 1000) / 1000
    const beat1 = Math.round(1.0 * 1000) / 1000; // 1.0
    const beat2 = Math.round((1 + 1 / 3) * 1000) / 1000; // 1.333
    const beat3 = Math.round((1 + 2 / 3) * 1000) / 1000; // 1.667

    addNote(score, {
      pitch: { step: "C", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: beat1,
    });
    addNote(score, {
      pitch: { step: "D", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: beat2,
    });
    addNote(score, {
      pitch: { step: "E", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: beat3,
    });

    const tuplet = score.parts[0]!.measures[0]!.sequences[0]!.content[1]!;
    const inner = (tuplet as Tuplet).content;
    expect((inner[0] as NoteEvent).notes![0].pitch.step).toBe("C");
    expect((inner[1] as NoteEvent).notes![0].pitch.step).toBe("D");
    expect((inner[2] as NoteEvent).notes![0].pitch.step).toBe("E");

    // Now place note at beat 2.0 (after tuplet) — should still work
    addNote(score, {
      pitch: { step: "F", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2.0,
    });

    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content[2]!.type).toBe("event");
    expect((content[2] as NoteEvent).notes![0].pitch.step).toBe("F");
  });
});

// ═══════════════════════════════════════════
// Beat count integrity — tuplets must not trigger repairBeatCounts
// ═══════════════════════════════════════════

describe("tuplet beat count integrity", () => {
  function totalSequenceBeats(score: Score, partIndex: number, measure: number, voice: number): number {
    const seq = score.parts[partIndex]?.measures[measure]?.sequences[voice];
    if (!seq) return 0;
    return seq.content.reduce((sum, item) => sum + sequenceContentBeats(item), 0);
  }

  it("creating a tuplet does not change total beat count", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Test",
          measures: [
            {
              sequences: [
                {
                  content: [
                    { type: "event", id: "ev1", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "ev2", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "ev3", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "ev4", duration: { base: "quarter" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Score;

    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    createTupletFromEvent(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 0,
      tupletNumber: 3,
    });

    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);
  });

  it("adding note inside tuplet does not change total beat count", () => {
    const score = makeScoreWithTuplet();
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    addNote(score, {
      pitch: { step: "C", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1.0,
    });

    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);
  });

  it("adding note OUTSIDE tuplet does not change total beat count", () => {
    const score = makeScoreWithTuplet();
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Add note at beat 2.0 (first rest after the tuplet)
    addNote(score, {
      pitch: { step: "D", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2.0,
    });

    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);
    // Verify the tuplet is still intact
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[1]!.type).toBe("tuplet");
  });

  it("adding note at beat 3.0 does not change total beat count", () => {
    const score = makeScoreWithTuplet();
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    addNote(score, {
      pitch: { step: "E", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 3.0,
    });

    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);
  });

  it("computeUsedBeats counts tuplet beats correctly", () => {
    const score = makeScoreWithTuplet();
    expect(computeUsedBeats(score, 0, 0, 0)).toBe(4);
  });

  it("sequenceContentBeats returns outer duration for tuplets", () => {
    // A 3:2 eighth tuplet occupies 2*0.5 = 1 beat
    expect(
      sequenceContentBeats({
        type: "tuplet",
        inner: { multiple: 3, duration: { base: "eighth" } },
        outer: { multiple: 2, duration: { base: "eighth" } },
        content: [],
      }),
    ).toBe(1.0);
  });

  it("multi-part score: tuplet on part 1 does not affect part 0", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Flute",
          measures: [
            { sequences: [{ content: [{ type: "event", id: "fl1", duration: { base: "whole" }, rest: {} }] }] },
          ],
        },
        {
          name: "Oboe",
          measures: [
            {
              sequences: [
                {
                  content: [
                    { type: "event", id: "ob1", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "ob2", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "ob3", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "ob4", duration: { base: "quarter" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Score;

    // Create tuplet on Oboe part
    createTupletFromEvent(score, {
      measureIndex: 0,
      partIndex: 1,
      voice: 0,
      eventIndex: 0,
      tupletNumber: 3,
    });

    expect(totalSequenceBeats(score, 1, 0, 0)).toBe(4);
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Add note inside oboe tuplet
    addNote(score, {
      pitch: { step: "A", octave: 4 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 1,
      voice: 0,
      beatPosition: 0,
    });

    expect(totalSequenceBeats(score, 1, 0, 0)).toBe(4);
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Add note after oboe tuplet
    addNote(score, {
      pitch: { step: "B", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 1,
      voice: 0,
      beatPosition: 1.0,
    });

    expect(totalSequenceBeats(score, 1, 0, 0)).toBe(4);
    // Verify tuplet still exists
    expect(score.parts[1]!.measures[0]!.sequences[0]!.content[0]!.type).toBe("tuplet");
  });
});

// ═══════════════════════════════════════════
// Note overwrite near tuplets
// ═══════════════════════════════════════════

describe("note overwrite near tuplets", () => {
  function totalSequenceBeats(score: Score, partIndex: number, measure: number, voice: number): number {
    const seq = score.parts[partIndex]?.measures[measure]?.sequences[voice];
    if (!seq) return 0;
    return seq.content.reduce((sum, item) => sum + sequenceContentBeats(item), 0);
  }

  it("overwrites a note at beat 0 when tuplet is at beat 1", () => {
    const score = makeScoreWithTuplet();
    // score has: [quarter_note@0, tuplet@1, quarter_rest@2, quarter_rest@3]
    // Overwrite the quarter note at beat 0 with a different pitch
    addNote(score, {
      pitch: { step: "G", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);
    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content[0]!.type).toBe("event");
    expect((content[0] as NoteEvent).notes![0].pitch.step).toBe("G");
    expect(content[1]!.type).toBe("tuplet");
  });

  it("overwrites a note after tuplet with another note", () => {
    const score = makeScoreWithTuplet();
    // First place a note at beat 2.0
    addNote(score, {
      pitch: { step: "D", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2.0,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Now overwrite that note with a different pitch
    addNote(score, {
      pitch: { step: "F", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2.0,
    });

    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);
    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content[1]!.type).toBe("tuplet");
    // The note at beat 2 should be F5
    const noteAt2 = content[2] as NoteEvent;
    expect(noteAt2.type).toBe("event");
    expect(noteAt2.notes![0].pitch.step).toBe("F");
  });

  it("overwrites note at beat 0 with shorter duration preserves tuplet", () => {
    const score = makeScoreWithTuplet();
    // Overwrite beat 0 quarter note with an eighth
    addNote(score, {
      pitch: { step: "A", octave: 4 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });

    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);
    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    // Should have: eighth note, eighth rest, tuplet, quarter rest, quarter rest
    expect((content[0] as NoteEvent).notes![0].pitch.step).toBe("A");
    // The tuplet should still exist somewhere
    expect(content.some((c) => c.type === "tuplet")).toBe(true);
  });
});

// ═══════════════════════════════════════════
// Cursor navigation with tuplets
// ═══════════════════════════════════════════

describe("cursor navigation with tuplets", () => {
  it("moveCursorToNextEvent visits all tuplet events", () => {
    const score = makeScoreWithTuplet();
    // Content: [quarter_note@0, tuplet@1(3 eighths), quarter_rest@2, quarter_rest@3]
    // Flattened beats: 0, 1.0, 1.333, 1.667, 2.0, 3.0
    let cursor = { measureIndex: 0, beatPosition: 0, partIndex: 0 };

    // Move to next → should land on first tuplet event (beat 1.0)
    cursor = moveCursorToNextEvent(score, cursor, 0);
    expect(cursor.beatPosition).toBeCloseTo(1.0, 3);

    // Next → second tuplet event (beat 1.333)
    cursor = moveCursorToNextEvent(score, cursor, 0);
    expect(cursor.beatPosition).toBeCloseTo(1 + 1 / 3, 3);

    // Next → third tuplet event (beat 1.667)
    cursor = moveCursorToNextEvent(score, cursor, 0);
    expect(cursor.beatPosition).toBeCloseTo(1 + 2 / 3, 3);

    // Next → quarter rest at beat 2.0
    cursor = moveCursorToNextEvent(score, cursor, 0);
    expect(cursor.beatPosition).toBeCloseTo(2.0, 3);

    // Next → quarter rest at beat 3.0
    cursor = moveCursorToNextEvent(score, cursor, 0);
    expect(cursor.beatPosition).toBeCloseTo(3.0, 3);
  });

  it("moveCursorToPreviousEvent walks backwards through tuplet", () => {
    const score = makeScoreWithTuplet();
    let cursor = { measureIndex: 0, beatPosition: 3.0, partIndex: 0 };

    cursor = moveCursorToPreviousEvent(score, cursor, 0);
    expect(cursor.beatPosition).toBeCloseTo(2.0, 3);

    cursor = moveCursorToPreviousEvent(score, cursor, 0);
    expect(cursor.beatPosition).toBeCloseTo(1 + 2 / 3, 3);

    cursor = moveCursorToPreviousEvent(score, cursor, 0);
    expect(cursor.beatPosition).toBeCloseTo(1 + 1 / 3, 3);

    cursor = moveCursorToPreviousEvent(score, cursor, 0);
    expect(cursor.beatPosition).toBeCloseTo(1.0, 3);

    cursor = moveCursorToPreviousEvent(score, cursor, 0);
    expect(cursor.beatPosition).toBeCloseTo(0, 3);
  });

  it("computeEndOfContentCursor with tuplet at end of content", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }, {}] },
      parts: [
        {
          name: "Test",
          measures: [
            {
              sequences: [
                {
                  content: [
                    {
                      type: "event",
                      id: "ev1",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { octave: 4, step: "C" } }],
                    },
                    {
                      type: "event",
                      id: "ev2",
                      duration: { base: "quarter" },
                      notes: [{ pitch: { octave: 4, step: "D" } }],
                    },
                    { type: "event", id: "ev3", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "ev4", duration: { base: "quarter" }, rest: {} },
                  ],
                },
              ],
            },
            {
              sequences: [{ content: [] }],
            },
          ],
        },
      ],
    } as unknown as Score;

    // Create tuplet from ev2 (quarter at beat 1)
    createTupletFromEvent(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      eventIndex: 1,
      tupletNumber: 3,
    });

    // Put notes in first two tuplet slots
    addNote(score, {
      pitch: { step: "E", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1.0,
    });
    addNote(score, {
      pitch: { step: "F", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1 + 1 / 3,
    });

    const cursor = computeEndOfContentCursor(score, 0, 0);
    // The measure has notes (both at beat 0 and inside tuplet at beat 1+1/3),
    // and total used beats = 4 (full measure), so cursor goes to next measure
    expect(cursor.measureIndex).toBe(1);
    expect(cursor.beatPosition).toBe(0);
  });
});

// ═══════════════════════════════════════════
// Full end-to-end tuplet workflow
// ═══════════════════════════════════════════

describe("full tuplet workflow", () => {
  function totalSequenceBeats(score: Score, partIndex: number, measure: number, voice: number): number {
    const seq = score.parts[partIndex]?.measures[measure]?.sequences[voice];
    if (!seq) return 0;
    return seq.content.reduce((sum, item) => sum + sequenceContentBeats(item), 0);
  }

  it("complete workflow: enter notes, create tuplet, enter more notes, overwrite", () => {
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
                    { type: "event", id: "r1", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "r2", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "r3", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "r4", duration: { base: "quarter" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Score;

    // Step 1: Enter notes at beats 0 and 1
    addNote(score, {
      pitch: { step: "C", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });
    addNote(score, {
      pitch: { step: "D", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1.0,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Step 2: Create triplet from note at beat 1
    createTupletFromEvent(score, { measureIndex: 0, partIndex: 0, voice: 0, eventIndex: 1, tupletNumber: 3 });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[1]!.type).toBe("tuplet");

    // Step 3: Enter notes into all 3 tuplet slots
    addNote(score, {
      pitch: { step: "E", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1.0,
    });
    addNote(score, {
      pitch: { step: "F", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1 + 1 / 3,
    });
    addNote(score, {
      pitch: { step: "G", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1 + 2 / 3,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Step 4: Enter note at beat 2.0 (rest after tuplet)
    addNote(score, {
      pitch: { step: "A", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2.0,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Step 5: Enter note at beat 3.0 (last quarter)
    addNote(score, {
      pitch: { step: "B", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 3.0,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Step 6: Overwrite note at beat 2.0 with different pitch
    addNote(score, {
      pitch: { step: "C", octave: 6 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2.0,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Verify final structure
    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content[0]!.type).toBe("event");
    expect(content[1]!.type).toBe("tuplet");
    expect((content[1] as Tuplet).content.length).toBe(3);
    expect(content.length).toBe(4); // note, tuplet, note, note

    // Verify correct pitches
    expect((content[0] as NoteEvent).notes![0].pitch.step).toBe("C");
    const tuplet = content[1] as Tuplet;
    expect((tuplet.content[0] as NoteEvent).notes![0].pitch.step).toBe("E");
    expect((tuplet.content[1] as NoteEvent).notes![0].pitch.step).toBe("F");
    expect((tuplet.content[2] as NoteEvent).notes![0].pitch.step).toBe("G");
    expect((content[2] as NoteEvent).notes![0].pitch.step).toBe("C"); // overwritten
    expect((content[3] as NoteEvent).notes![0].pitch.step).toBe("B");
  });

  it("tuplet at start of measure (beat 0)", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Test",
          measures: [
            {
              sequences: [
                {
                  content: [
                    { type: "event", id: "r1", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "r2", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "r3", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "r4", duration: { base: "quarter" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Score;

    // Create tuplet at beat 0
    createTupletFromEvent(score, { measureIndex: 0, partIndex: 0, voice: 0, eventIndex: 0, tupletNumber: 3 });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Enter notes into tuplet
    addNote(score, {
      pitch: { step: "C", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });
    addNote(score, {
      pitch: { step: "D", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1 / 3,
    });
    addNote(score, {
      pitch: { step: "E", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2 / 3,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Enter notes after tuplet
    addNote(score, {
      pitch: { step: "F", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1.0,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    addNote(score, {
      pitch: { step: "G", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2.0,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    addNote(score, {
      pitch: { step: "A", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 3.0,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Verify structure
    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content[0]!.type).toBe("tuplet");
    expect(content.length).toBe(4); // tuplet, note, note, note
  });

  it("tuplet at end of measure (beat 3)", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Test",
          measures: [
            {
              sequences: [
                {
                  content: [
                    { type: "event", id: "r1", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "r2", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "r3", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "r4", duration: { base: "quarter" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Score;

    // Create tuplet at beat 3 (last quarter)
    createTupletFromEvent(score, { measureIndex: 0, partIndex: 0, voice: 0, eventIndex: 3, tupletNumber: 3 });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Enter notes before tuplet
    addNote(score, {
      pitch: { step: "C", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });
    addNote(score, {
      pitch: { step: "D", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1.0,
    });
    addNote(score, {
      pitch: { step: "E", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2.0,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Enter notes into tuplet
    addNote(score, {
      pitch: { step: "F", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 3.0,
    });
    addNote(score, {
      pitch: { step: "G", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 3 + 1 / 3,
    });
    addNote(score, {
      pitch: { step: "A", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 3 + 2 / 3,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content[3]!.type).toBe("tuplet");
    expect(content.length).toBe(4); // note, note, note, tuplet
  });

  it("multiple tuplets in one measure", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [
        {
          name: "Test",
          measures: [
            {
              sequences: [
                {
                  content: [
                    { type: "event", id: "r1", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "r2", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "r3", duration: { base: "quarter" }, rest: {} },
                    { type: "event", id: "r4", duration: { base: "quarter" }, rest: {} },
                  ],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Score;

    // Create tuplet at beat 0 and beat 2
    createTupletFromEvent(score, { measureIndex: 0, partIndex: 0, voice: 0, eventIndex: 0, tupletNumber: 3 });
    createTupletFromEvent(score, { measureIndex: 0, partIndex: 0, voice: 0, eventIndex: 2, tupletNumber: 3 });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Content: [tuplet, quarter_rest, tuplet, quarter_rest]
    const content = score.parts[0]!.measures[0]!.sequences[0]!.content;
    expect(content[0]!.type).toBe("tuplet");
    expect(content[2]!.type).toBe("tuplet");

    // Enter notes into first tuplet
    addNote(score, {
      pitch: { step: "C", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Enter note between tuplets (beat 1.0)
    addNote(score, {
      pitch: { step: "D", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1.0,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);

    // Enter note into second tuplet (beat 2.0)
    addNote(score, {
      pitch: { step: "E", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 2.0,
    });
    expect(totalSequenceBeats(score, 0, 0, 0)).toBe(4);
  });

  it("no hardcoded partIndex=0 in InputCursor buildBeatMap augmentation", () => {
    const source = readFileSync(resolve(__dirname, "../components/inputCursorHelpers.ts"), "utf-8");

    const fnStart = source.indexOf("function buildBeatMap");
    expect(fnStart).toBeGreaterThan(-1);
    // Use a larger window to include the augmentation code
    const fnBody = source.slice(fnStart, fnStart + 4000);

    // Must NOT have const partIndex = 0
    expect(fnBody).not.toContain("const partIndex = 0");

    // Must use the partIndex parameter to look up the sequence
    expect(fnBody).toContain("score.parts[partIndex]");
  });

  it("no hardcoded voice in snap pipeline", () => {
    const source = readFileSync(resolve(__dirname, "../components/inputCursorHelpers.ts"), "utf-8");

    // computeSnappedBeat should resolve partIndex from mouse Y
    const snapFn = source.indexOf("export function computeSnappedBeat");
    expect(snapFn).toBeGreaterThan(-1);
    const snapBody = source.slice(snapFn, snapFn + 2500);
    expect(snapBody).toContain("partIndexOverride");
    expect(snapBody).toContain("resolvedPartIndex");
  });
});
