import { describe, it, expect } from "vitest";
import type { Score, NoteEvent, Pitch } from "@viritura/core";
import { applyPatchesToScore } from "@viritura/core";
import type { Step, Octave } from "@viritura/core";
import {
  transposePitchChromatic,
  transposePitchDiatonic,
  transposeNotes,
  planTransposeNotes,
  resolveEntryPitch,
} from "../commands/transposeCommands";
import { resolveSelectionEvents } from "../store/selectionUtils";
import type { Selection } from "../store/selectionStore";

// ═══════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════

function makePitch(step: Step, octave: Octave, alter?: number): Pitch {
  return alter !== undefined ? { step, octave, alter } : { step, octave };
}

function makeNote(
  id: string,
  base: "whole" | "half" | "quarter" | "eighth",
  step: Step = "C",
  octave: Octave = 4,
  alter?: number,
): NoteEvent {
  const pitch: Pitch = alter !== undefined ? { step, octave, alter } : { step, octave };
  return {
    type: "event",
    id,
    duration: { base },
    notes: [{ pitch }],
  };
}

function makeRest(id: string, base: "whole" | "half" | "quarter" | "eighth"): NoteEvent {
  return {
    type: "event",
    id,
    duration: { base },
    rest: {},
  };
}

function makeScore(events: NoteEvent[], keyFifths = 0): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 }, key: { fifths: keyFifths } }],
    },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [{ content: events }],
          },
        ],
      },
    ],
  };
}

// ═══════════════════════════════════════════
// transposePitchChromatic tests
// ═══════════════════════════════════════════

describe("transposePitchChromatic", () => {
  it("transposes C4 up a half step to C#4", () => {
    const result = transposePitchChromatic(makePitch("C", 4), 1);
    expect(result.step).toBe("C");
    expect(result.octave).toBe(4);
    expect(result.alter).toBe(1);
  });

  it("transposes C4 up a whole step to D4", () => {
    const result = transposePitchChromatic(makePitch("C", 4), 2);
    expect(result.step).toBe("D");
    expect(result.octave).toBe(4);
    expect(result.alter).toBeUndefined();
  });

  it("transposes C4 down a half step to B3", () => {
    const result = transposePitchChromatic(makePitch("C", 4), -1);
    expect(result.step).toBe("B");
    expect(result.octave).toBe(3);
    expect(result.alter).toBeUndefined();
  });

  it("transposes C4 up an octave to C5", () => {
    const result = transposePitchChromatic(makePitch("C", 4), 12);
    expect(result.step).toBe("C");
    expect(result.octave).toBe(5);
    expect(result.alter).toBeUndefined();
  });

  it("preserves an A-flat spelling when transposing by an octave", () => {
    const result = transposePitchChromatic(makePitch("A", 4, -1), 12);
    expect(result).toEqual({ step: "A", octave: 5, alter: -1 });
  });

  it("transposes E4 up a half step to F4", () => {
    const result = transposePitchChromatic(makePitch("E", 4), 1);
    expect(result.step).toBe("F");
    expect(result.octave).toBe(4);
    expect(result.alter).toBeUndefined();
  });

  it("transposes B4 up a half step to C5", () => {
    const result = transposePitchChromatic(makePitch("B", 4), 1);
    expect(result.step).toBe("C");
    expect(result.octave).toBe(5);
    expect(result.alter).toBeUndefined();
  });

  it("transposes F#4 up a half step to G4", () => {
    const result = transposePitchChromatic(makePitch("F", 4, 1), 1);
    expect(result.step).toBe("G");
    expect(result.octave).toBe(4);
    expect(result.alter).toBeUndefined();
  });

  it("transposes Bb4 down a half step to A4", () => {
    const result = transposePitchChromatic(makePitch("B", 4, -1), -1);
    expect(result.step).toBe("A");
    expect(result.octave).toBe(4);
    expect(result.alter).toBeUndefined();
  });

  it("transposes by 0 semitones returns the same pitch", () => {
    const result = transposePitchChromatic(makePitch("G", 5), 0);
    expect(result.step).toBe("G");
    expect(result.octave).toBe(5);
    expect(result.alter).toBeUndefined();
  });

  it("clamps at octave 0 (low bound)", () => {
    const result = transposePitchChromatic(makePitch("C", 0), -12);
    expect(result.octave).toBeGreaterThanOrEqual(0);
  });

  it("clamps at octave 9 (high bound)", () => {
    const result = transposePitchChromatic(makePitch("C", 9), 12);
    expect(result.octave).toBeLessThanOrEqual(9);
  });

  it("transposes a major third up from C4 to E4", () => {
    const result = transposePitchChromatic(makePitch("C", 4), 4);
    expect(result.step).toBe("E");
    expect(result.octave).toBe(4);
    expect(result.alter).toBeUndefined();
  });

  it("transposes a perfect fifth up from C4 to G4", () => {
    const result = transposePitchChromatic(makePitch("C", 4), 7);
    expect(result.step).toBe("G");
    expect(result.octave).toBe(4);
    expect(result.alter).toBeUndefined();
  });
});

// ═══════════════════════════════════════════
// transposePitchDiatonic tests
// ═══════════════════════════════════════════

describe("transposePitchDiatonic", () => {
  it("transposes C4 up one diatonic step in C major to D4", () => {
    const result = transposePitchDiatonic(makePitch("C", 4), 1, 0);
    expect(result.step).toBe("D");
    expect(result.octave).toBe(4);
    expect(result.alter).toBeUndefined();
  });

  it("transposes E4 up one diatonic step in C major to F4", () => {
    const result = transposePitchDiatonic(makePitch("E", 4), 1, 0);
    expect(result.step).toBe("F");
    expect(result.octave).toBe(4);
    expect(result.alter).toBeUndefined();
  });

  it("transposes B4 up one diatonic step in C major to C5", () => {
    const result = transposePitchDiatonic(makePitch("B", 4), 1, 0);
    expect(result.step).toBe("C");
    expect(result.octave).toBe(5);
  });

  it("transposes C4 down one diatonic step in C major to B3", () => {
    const result = transposePitchDiatonic(makePitch("C", 4), -1, 0);
    expect(result.step).toBe("B");
    expect(result.octave).toBe(3);
  });

  it("transposes F#4 up one diatonic step in G major (1 sharp)", () => {
    const result = transposePitchDiatonic(makePitch("F", 4, 1), 1, 1);
    expect(result.step).toBe("G");
    expect(result.octave).toBe(4);
  });

  it("transposes up by 7 diatonic steps (octave)", () => {
    const result = transposePitchDiatonic(makePitch("C", 4), 7, 0);
    expect(result.step).toBe("C");
    expect(result.octave).toBe(5);
  });
});

// ═══════════════════════════════════════════
// transposeNotes (score-level) tests
// ═══════════════════════════════════════════

describe("transposeNotes", () => {
  it("transposes a single note chromatically", () => {
    const score = makeScore([makeNote("e1", "quarter", "C", 4)]);
    const result = transposeNotes(
      score,
      [{ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 }],
      "chromatic",
      2,
    );
    const event = result.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    expect(event.notes![0]!.pitch.step).toBe("D");
    expect(event.notes![0]!.pitch.octave).toBe(4);
  });

  it("does not modify rests", () => {
    const score = makeScore([makeRest("e1", "quarter")]);
    const result = transposeNotes(
      score,
      [{ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 }],
      "chromatic",
      2,
    );
    const event = result.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    expect(event.rest).toBeDefined();
    expect(event.notes).toBeUndefined();
  });

  it("does not mutate the original score", () => {
    const score = makeScore([makeNote("e1", "quarter", "C", 4)]);
    transposeNotes(score, [{ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 }], "chromatic", 2);
    const event = score.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    expect(event.notes![0]!.pitch.step).toBe("C");
    expect(event.notes![0]!.pitch.octave).toBe(4);
  });

  it("transposes a chord (multiple notes)", () => {
    const event: NoteEvent = {
      type: "event",
      id: "e1",
      duration: { base: "quarter" },
      notes: [
        { pitch: { step: "C", octave: 4 } },
        { pitch: { step: "E", octave: 4 } },
        { pitch: { step: "G", octave: 4 } },
      ],
    };
    const score = makeScore([event]);
    const result = transposeNotes(
      score,
      [{ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 }],
      "chromatic",
      2,
    );
    const resEvent = result.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    expect(resEvent.notes![0]!.pitch.step).toBe("D");
    expect(resEvent.notes![1]!.pitch.step).toBe("F");
    // G + 2 semitones = A
    expect(resEvent.notes![2]!.pitch.step).toBe("A");
  });
});

describe("planTransposeNotes", () => {
  it("matches legacy transpose without cloning the score", () => {
    const score = makeScore([makeNote("e1", "quarter", "C", 4)]);
    score.parts[0]!.id = "part-1";
    score.parts[0]!.measures[0]!.sequences[0]!.content[0] = {
      ...score.parts[0]!.measures[0]!.sequences[0]!.content[0]!,
      notes: [{ id: "note-1", pitch: { step: "C", octave: 4 } }],
    } as NoteEvent;
    const locations = [{ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 }];

    const patches = planTransposeNotes(score, locations, "chromatic", 12);
    expect(patches).toEqual([
      {
        kind: "setNotePitch",
        locator: {
          sequencePath: { partId: "part-1", measureIndex: 0, voice: 0 },
          eventId: "e1",
        },
        noteId: "note-1",
        pitch: { step: "C", octave: 5 },
      },
    ]);
    expect(applyPatchesToScore(score, patches!)).toEqual(transposeNotes(score, locations, "chromatic", 12));
  });

  it("returns null when stable patch IDs are unavailable", () => {
    const score = makeScore([makeNote("e1", "quarter", "C", 4)]);
    expect(
      planTransposeNotes(score, [{ partIndex: 0, measureIndex: 0, sequenceIndex: 0, eventIndex: 0 }], "chromatic", 1),
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════
// Selection-driven transpose (mirrors useScoreEditingActions.handleTransposeDialog:
// resolveSelectionEvents -> transposeNotes). Locks all-kinds behaviour.
// ═══════════════════════════════════════════

describe("transpose via resolveSelectionEvents", () => {
  function threeNoteScore(): Score {
    return makeScore([
      makeNote("e0", "quarter", "C", 4),
      makeNote("e1", "quarter", "C", 4),
      makeNote("e2", "quarter", "C", 4),
    ]);
  }

  function steps(score: Score): string[] {
    return (score.parts[0]!.measures[0]!.sequences[0]!.content as NoteEvent[]).map((e) => e.notes![0]!.pitch.step);
  }

  it("transposes every event of a multi selection", () => {
    const score = threeNoteScore();
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/e0", "p0/m0/s0/e2"] };
    const result = transposeNotes(score, resolveSelectionEvents(sel, score), "chromatic", 2);
    // C->D for the two selected; the middle stays C.
    expect(steps(result)).toEqual(["D", "C", "D"]);
  });

  it("transposes a chord exactly once when two of its noteheads are multi-selected", () => {
    const chordScore = makeScore([
      {
        type: "event",
        id: "chord0",
        duration: { base: "quarter" },
        notes: [{ pitch: { step: "C", octave: 4 } }, { pitch: { step: "E", octave: 4 } }],
      },
    ]);
    const sel: Selection = { kind: "multi", elementIds: ["p0/m0/s0/chord0/n0", "p0/m0/s0/chord0/n1"] };
    const locations = resolveSelectionEvents(sel, chordScore);
    expect(locations).toHaveLength(1); // deduped to the single chord event
    const result = transposeNotes(chordScore, locations, "chromatic", 2);
    const ev = result.parts[0]!.measures[0]!.sequences[0]!.content[0] as NoteEvent;
    expect(ev.notes!.map((n) => n.pitch.step)).toEqual(["D", "F"]);
  });

  it("produces no events for an empty selection", () => {
    expect(resolveSelectionEvents({ kind: "none" }, threeNoteScore())).toEqual([]);
  });
});

// ═══════════════════════════════════════════
// resolveEntryPitch — the single source of truth for the written↔sounding
// split shared by the keyboard (buildEntryPitch) and click (addNoteAtClick)
// note-entry paths. These assert the split so audio preview, octave memory,
// and storage can never drift apart on transposing instruments again.
// ═══════════════════════════════════════════

describe("resolveEntryPitch", () => {
  /** Score with one transposing part. `interval` per MNX: sounding + interval = written. */
  function transposingScore(
    interval: { halfSteps: number; staffDistance: number },
    opts: { useWritten?: boolean; prefersWrittenPitches?: boolean; keyFifths?: number } = {},
  ): Score {
    return {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: opts.keyFifths ?? 0 } }] },
      ...(opts.useWritten ? { scores: [{ name: "S", useWritten: true }] } : {}),
      parts: [
        {
          name: "Xpose",
          transposition: {
            interval,
            ...(opts.prefersWrittenPitches ? { prefersWrittenPitches: true } : {}),
          },
          measures: [{ sequences: [{ content: [] }] }],
        },
      ],
    } as Score;
  }

  it("piccolo (prefersWrittenPitches): written C5 → sounding C6, written unchanged", () => {
    // Piccolo sounds an octave above written.
    const score = transposingScore({ halfSteps: -12, staffDistance: -7 }, { prefersWrittenPitches: true });
    const { written, sounding } = resolveEntryPitch({ step: "C", octave: 5 }, score, 0, 0);
    expect(written).toEqual({ step: "C", octave: 5 });
    expect(sounding).toEqual({ step: "C", octave: 6 });
  });

  it("double bass (prefersWrittenPitches): written E2 → sounding E1", () => {
    // Double bass sounds an octave below written.
    const score = transposingScore({ halfSteps: 12, staffDistance: 7 }, { prefersWrittenPitches: true });
    const { written, sounding } = resolveEntryPitch({ step: "E", octave: 2 }, score, 0, 0);
    expect(written).toEqual({ step: "E", octave: 2 });
    expect(sounding).toEqual({ step: "E", octave: 1 });
  });

  it("Bb clarinet in useWritten mode: written C5 → sounding Bb4", () => {
    // Bb clarinet sounds a major 2nd below written (sounding + M2 = written).
    const score = transposingScore({ halfSteps: 2, staffDistance: 1 }, { useWritten: true });
    const { written, sounding } = resolveEntryPitch({ step: "C", octave: 5 }, score, 0, 0);
    expect(written).toEqual({ step: "C", octave: 5 });
    expect(sounding).toEqual({ step: "B", octave: 4, alter: -1 });
  });

  it("transposing part NOT in written mode: written === sounding (no conversion)", () => {
    // prefersWrittenPitches false + score not useWritten → entry is concert pitch.
    const score = transposingScore({ halfSteps: 2, staffDistance: 1 });
    const { written, sounding } = resolveEntryPitch({ step: "C", octave: 5 }, score, 0, 0);
    expect(written).toEqual({ step: "C", octave: 5 });
    expect(sounding).toEqual({ step: "C", octave: 5 });
  });

  it("concert part with no transposition: written === sounding", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }] },
      parts: [{ name: "Piano", measures: [{ sequences: [{ content: [] }] }] }],
    } as Score;
    const { written, sounding } = resolveEntryPitch({ step: "G", octave: 4, alter: 1 }, score, 0, 0);
    expect(written).toEqual({ step: "G", octave: 4, alter: 1 });
    expect(sounding).toEqual({ step: "G", octave: 4, alter: 1 });
  });

  it("returns independent objects (mutating one does not affect the other)", () => {
    const score = transposingScore({ halfSteps: -12, staffDistance: -7 }, { prefersWrittenPitches: true });
    const { written, sounding } = resolveEntryPitch({ step: "C", octave: 5 }, score, 0, 0);
    sounding.octave = 9 as typeof sounding.octave;
    expect(written.octave).toBe(5);
  });
});
