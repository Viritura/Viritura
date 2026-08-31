import { describe, it, expect, beforeEach } from "vitest";
import type { Score, Grace, NoteEvent } from "@viritura/core";
import { addGraceNote, addNote, resetIdCounter } from "../commands/noteCommands";
import { createTuplet } from "../commands/tupletCommands";
import { noteInputReducer, initialNoteInputState } from "../store/noteInputStore";

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function makeScoreWithWholeRest(): Score {
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
                    duration: { base: "whole" },
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
}

// ═══════════════════════════════════════════
// addGraceNote tests
// ═══════════════════════════════════════════

describe("addGraceNote", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  it("creates a new Grace container before the target event", () => {
    const score = makeScoreWithNote();
    const result = addGraceNote(score, {
      pitch: { step: "B", octave: 4 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      slash: true,
    });

    const seq = result.parts[0]!.measures[0]!.sequences[0]!;
    expect(seq.content).toHaveLength(2);

    const grace = seq.content[0] as Grace;
    expect(grace.type).toBe("grace");
    expect(grace.slash).toBe(true);
    expect(grace.content).toHaveLength(1);
    expect(grace.content[0]!.notes![0]!.pitch.step).toBe("B");
    expect(grace.content[0]!.notes![0]!.pitch.octave).toBe(4);
    expect(grace.content[0]!.duration.base).toBe("eighth");

    // Main event still there
    const mainEvent = seq.content[1] as NoteEvent;
    expect(mainEvent.type).toBe("event");
    expect(mainEvent.notes![0]!.pitch.step).toBe("C");
  });

  it("inserts before the targeted event inside a tuplet", () => {
    const score = makeScoreWithWholeRest();
    createTuplet(score, {
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      tupletNumber: 3,
      baseDuration: { base: "eighth" },
    });

    addGraceNote(score, {
      pitch: { step: "D", octave: 5 },
      duration: { base: "16th" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 1 / 3,
      slash: true,
    });

    const tuplet = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(tuplet.type).toBe("tuplet");
    if (tuplet.type !== "tuplet") return;
    expect(tuplet.content.map((item) => item.type)).toEqual(["event", "grace", "event", "event"]);

    expect(() =>
      addNote(score, {
        pitch: { step: "E", octave: 5 },
        duration: { base: "eighth" },
        measureIndex: 0,
        partIndex: 0,
        voice: 0,
        beatPosition: 1 / 3,
      }),
    ).not.toThrow();
    expect(tuplet.content[2]!.type).toBe("event");
    expect((tuplet.content[2] as NoteEvent).notes?.[0]?.pitch.step).toBe("E");
  });

  it("creates appoggiatura (slash=false)", () => {
    const score = makeScoreWithNote();
    const result = addGraceNote(score, {
      pitch: { step: "D", octave: 5 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      slash: false,
    });

    const grace = result.parts[0]!.measures[0]!.sequences[0]!.content[0] as Grace;
    expect(grace.slash).toBe(false);
    expect(grace.content[0]!.duration.base).toBe("quarter");
  });

  it("appends to existing Grace group with matching slash", () => {
    const score = makeScoreWithNote();
    // Add first grace note
    addGraceNote(score, {
      pitch: { step: "B", octave: 4 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      slash: true,
    });

    // Add second grace note — should append to existing group
    addGraceNote(score, {
      pitch: { step: "A", octave: 4 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      slash: true,
    });

    const seq = score.parts[0]!.measures[0]!.sequences[0]!;
    // Should still be 2 items: grace group + main note
    expect(seq.content).toHaveLength(2);

    const grace = seq.content[0] as Grace;
    expect(grace.content).toHaveLength(2);
    expect(grace.content[0]!.notes![0]!.pitch.step).toBe("B");
    expect(grace.content[1]!.notes![0]!.pitch.step).toBe("A");
  });

  it("creates separate Grace group when slash differs", () => {
    const score = makeScoreWithNote();
    // Add acciaccatura
    addGraceNote(score, {
      pitch: { step: "B", octave: 4 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      slash: true,
    });

    // Add appoggiatura — different slash, should create new group
    addGraceNote(score, {
      pitch: { step: "A", octave: 4 },
      duration: { base: "quarter" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      slash: false,
    });

    const seq = score.parts[0]!.measures[0]!.sequences[0]!;
    // Should be 3 items: grace(slash=true) + grace(slash=false) + main note
    expect(seq.content).toHaveLength(3);

    const grace1 = seq.content[0] as Grace;
    expect(grace1.slash).toBe(true);
    const grace2 = seq.content[1] as Grace;
    expect(grace2.slash).toBe(false);
  });

  it("inserts grace before a rest", () => {
    const score = makeScoreWithWholeRest();
    const result = addGraceNote(score, {
      pitch: { step: "E", octave: 5 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 0,
      beatPosition: 0,
      slash: true,
    });

    const seq = result.parts[0]!.measures[0]!.sequences[0]!;
    expect(seq.content).toHaveLength(2);
    expect((seq.content[0] as Grace).type).toBe("grace");
    expect((seq.content[1] as NoteEvent).rest).toBeDefined();
  });

  it("creates sequence if voice does not exist", () => {
    const score = makeScoreWithNote();
    const result = addGraceNote(score, {
      pitch: { step: "F", octave: 4 },
      duration: { base: "eighth" },
      measureIndex: 0,
      partIndex: 0,
      voice: 1,
      beatPosition: 0,
      slash: true,
    });

    expect(result.parts[0]!.measures[0]!.sequences).toHaveLength(2);
    const seq = result.parts[0]!.measures[0]!.sequences[1]!;
    expect(seq.content).toHaveLength(1);
    expect((seq.content[0] as Grace).type).toBe("grace");
  });
});

// ═══════════════════════════════════════════
// noteInputReducer grace note tests
// ═══════════════════════════════════════════

describe("noteInputReducer grace note handling", () => {
  it("sets grace type to acciaccatura", () => {
    const s = noteInputReducer(initialNoteInputState, {
      type: "SET_GRACE_TYPE",
      graceType: "grace",
    });
    expect(s.currentGraceType).toBe("grace");
  });

  it("sets grace type to appoggiatura", () => {
    const s = noteInputReducer(initialNoteInputState, {
      type: "SET_GRACE_TYPE",
      graceType: "appoggiatura",
    });
    expect(s.currentGraceType).toBe("appoggiatura");
  });

  it("toggles grace off via TOGGLE_GRACE_ACTIVE and back on using the picker memory", () => {
    let s = noteInputReducer(initialNoteInputState, {
      type: "SET_GRACE_TYPE",
      graceType: "appoggiatura",
    });
    expect(s.currentGraceType).toBe("appoggiatura");
    expect(s.selectedGraceType).toBe("appoggiatura");

    // Toggle off — selectedGraceType is preserved.
    s = noteInputReducer(s, { type: "TOGGLE_GRACE_ACTIVE" });
    expect(s.currentGraceType).toBeNull();
    expect(s.selectedGraceType).toBe("appoggiatura");

    // Toggle back on — restores selectedGraceType (NOT the default).
    s = noteInputReducer(s, { type: "TOGGLE_GRACE_ACTIVE" });
    expect(s.currentGraceType).toBe("appoggiatura");
  });

  it("switches grace type when different type selected", () => {
    const s1 = noteInputReducer(initialNoteInputState, {
      type: "SET_GRACE_TYPE",
      graceType: "grace",
    });
    const s2 = noteInputReducer(s1, {
      type: "SET_GRACE_TYPE",
      graceType: "appoggiatura",
    });
    expect(s2.currentGraceType).toBe("appoggiatura");
    expect(s2.selectedGraceType).toBe("appoggiatura");
  });

  it("resets grace type when toggling note input off", () => {
    let s = noteInputReducer(initialNoteInputState, { type: "TOGGLE_NOTE_INPUT" });
    s = noteInputReducer(s, { type: "SET_GRACE_TYPE", graceType: "grace" });
    expect(s.currentGraceType).toBe("grace");

    // Toggle off
    s = noteInputReducer(s, { type: "TOGGLE_NOTE_INPUT" });
    expect(s.currentGraceType).toBeNull();
  });
});
