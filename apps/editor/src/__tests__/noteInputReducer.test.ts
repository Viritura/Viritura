import { describe, it, expect } from "vitest";
import { noteInputReducer, initialNoteInputState, type NoteInputState } from "../store/noteInputStore";

describe("noteInputReducer", () => {
  it("has correct initial state", () => {
    expect(initialNoteInputState).toEqual({
      active: false,
      currentDuration: "quarter",
      currentAccidental: null,
      isRest: false,
      dotCount: 0,
      selectedDotCount: 1,
      currentVoice: 1,
      currentGraceType: null,
      selectedGraceType: "grace",
      tieActive: false,
      slurActive: false,
      slurStartEventId: null,
      chordLock: false,
      lastPitch: null,
      cursorPosition: null,
      condensingRouting: null,
    });
  });

  it("toggles active state", () => {
    const s1 = noteInputReducer(initialNoteInputState, { type: "TOGGLE_NOTE_INPUT" });
    expect(s1.active).toBe(true);
    const s2 = noteInputReducer(s1, { type: "TOGGLE_NOTE_INPUT" });
    expect(s2.active).toBe(false);
  });

  it("sets duration", () => {
    const s = noteInputReducer(initialNoteInputState, {
      type: "SET_DURATION",
      duration: "eighth",
    });
    expect(s.currentDuration).toBe("eighth");
  });

  it("toggles rest mode", () => {
    const s1 = noteInputReducer(initialNoteInputState, { type: "TOGGLE_REST" });
    expect(s1.isRest).toBe(true);
    const s2 = noteInputReducer(s1, { type: "TOGGLE_REST" });
    expect(s2.isRest).toBe(false);
  });

  it("clears grace mode when rest mode is enabled", () => {
    const grace = noteInputReducer(initialNoteInputState, {
      type: "SET_GRACE_TYPE",
      graceType: "grace",
    });
    const rest = noteInputReducer(grace, { type: "TOGGLE_REST" });
    expect(rest.isRest).toBe(true);
    expect(rest.currentGraceType).toBeNull();
  });

  it("clears rest mode when grace mode is enabled", () => {
    const rest = noteInputReducer(initialNoteInputState, { type: "TOGGLE_REST" });
    const grace = noteInputReducer(rest, { type: "TOGGLE_GRACE_ACTIVE" });
    expect(grace.isRest).toBe(false);
    expect(grace.currentGraceType).toBe("grace");
  });

  it("sets dot count", () => {
    const s = noteInputReducer(initialNoteInputState, {
      type: "SET_DOT_COUNT",
      dotCount: 1,
    });
    expect(s.dotCount).toBe(1);
  });

  it("sets accidental", () => {
    const s = noteInputReducer(initialNoteInputState, {
      type: "SET_ACCIDENTAL",
      accidental: "sharp",
    });
    expect(s.currentAccidental).toBe("sharp");
  });

  it("toggles accidental off when same clicked again", () => {
    const s1: NoteInputState = { ...initialNoteInputState, currentAccidental: "sharp" };
    const s2 = noteInputReducer(s1, {
      type: "SET_ACCIDENTAL",
      accidental: "sharp",
    });
    expect(s2.currentAccidental).toBeNull();
  });

  it("switches accidental when different one clicked", () => {
    const s1: NoteInputState = { ...initialNoteInputState, currentAccidental: "sharp" };
    const s2 = noteInputReducer(s1, {
      type: "SET_ACCIDENTAL",
      accidental: "flat",
    });
    expect(s2.currentAccidental).toBe("flat");
  });

  it("sets accidental to null explicitly", () => {
    const s1: NoteInputState = { ...initialNoteInputState, currentAccidental: "sharp" };
    const s2 = noteInputReducer(s1, {
      type: "SET_ACCIDENTAL",
      accidental: null,
    });
    expect(s2.currentAccidental).toBeNull();
  });

  it("clears dotCount when changing duration", () => {
    const s1: NoteInputState = {
      active: true,
      currentDuration: "quarter",
      isRest: true,
      dotCount: 1,
      currentAccidental: "flat",
      currentVoice: 1,
      currentGraceType: null,
      tieActive: false,
      slurActive: false,
      slurStartEventId: null,
      lastPitch: null,
      cursorPosition: null,
    };
    const s2 = noteInputReducer(s1, { type: "SET_DURATION", duration: "16th" });
    expect(s2.active).toBe(true);
    expect(s2.isRest).toBe(true);
    // Dot count is cleared when the duration changes: a dotted-quarter
    // selection becomes a plain 16th, not a dotted 16th.
    expect(s2.dotCount).toBe(0);
    expect(s2.currentAccidental).toBe("flat");
    expect(s2.currentDuration).toBe("16th");
  });

  it("cycles through all durations", () => {
    const durations = ["whole", "half", "quarter", "eighth", "16th", "32nd"] as const;
    for (const d of durations) {
      const s = noteInputReducer(initialNoteInputState, {
        type: "SET_DURATION",
        duration: d,
      });
      expect(s.currentDuration).toBe(d);
    }
  });

  it("cycles through all accidentals", () => {
    const accidentals = ["double-flat", "flat", "natural", "sharp", "double-sharp"] as const;
    for (const a of accidentals) {
      const s = noteInputReducer(initialNoteInputState, {
        type: "SET_ACCIDENTAL",
        accidental: a,
      });
      expect(s.currentAccidental).toBe(a);
    }
  });

  it("sets lastPitch", () => {
    const pitch = { step: "C" as const, octave: 4 as const };
    const s = noteInputReducer(initialNoteInputState, {
      type: "SET_LAST_PITCH",
      pitch,
    });
    expect(s.lastPitch).toEqual(pitch);
  });

  it("clears lastPitch", () => {
    const s1 = noteInputReducer(initialNoteInputState, {
      type: "SET_LAST_PITCH",
      pitch: { step: "D" as const, octave: 5 as const },
    });
    const s2 = noteInputReducer(s1, { type: "CLEAR_LAST_PITCH" });
    expect(s2.lastPitch).toBeNull();
  });

  it("resets lastPitch on RESET", () => {
    const s1 = noteInputReducer(initialNoteInputState, {
      type: "SET_LAST_PITCH",
      pitch: { step: "E" as const, octave: 3 as const },
    });
    const s2 = noteInputReducer(s1, { type: "RESET" });
    expect(s2.lastPitch).toBeNull();
  });
});
