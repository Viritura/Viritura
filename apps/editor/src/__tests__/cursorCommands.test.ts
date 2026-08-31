import { describe, it, expect } from "vitest";
import {
  noteInputReducer,
  initialNoteInputState,
  type NoteInputState,
  type CursorPosition,
} from "../store/noteInputStore";
import {
  computeUsedBeats,
  getActiveTimeSignature,
  computeEndOfContentCursor,
  advanceCursor,
  moveCursorLeft,
  moveCursorRight,
  moveCursorToPreviousEvent,
  moveCursorToNextEvent,
  moveCursorToNextMeasure,
} from "../commands/cursorCommands";
import type { Score } from "@viritura/core";

// ─── Helper: minimal score factory ────

function makeScore(measures: number, timeCount = 4, timeUnit = 4): Score {
  const globalMeasures = [];
  const partMeasures = [];
  for (let i = 0; i < measures; i++) {
    globalMeasures.push(i === 0 ? { time: { count: timeCount, unit: timeUnit } } : {});
    partMeasures.push({
      sequences: [{ content: [{ type: "event" as const, duration: { base: "whole" as const }, rest: {} }] }],
    });
  }
  return {
    global: { measures: globalMeasures },
    parts: [{ measures: partMeasures }],
  } as Score;
}

function makeScoreWithNotes(): Score {
  // 4/4 time, 2 measures: first has 2 quarter notes, second is empty (whole rest)
  return {
    global: {
      measures: [{ time: { count: 4, unit: 4 } }, {}],
    },
    parts: [
      {
        measures: [
          {
            sequences: [
              {
                content: [
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                  { type: "event", duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 5 } }] },
                  { type: "event", duration: { base: "half" }, rest: {} },
                ],
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
  } as Score;
}

// ─── Reducer tests ────

describe("noteInputReducer cursor actions", () => {
  it("SET_CURSOR sets cursor position", () => {
    const pos: CursorPosition = { measureIndex: 2, beatPosition: 1.5, partIndex: 0 };
    const state = noteInputReducer(initialNoteInputState, {
      type: "SET_CURSOR",
      position: pos,
    });
    expect(state.cursorPosition).toEqual(pos);
  });

  it("CLEAR_CURSOR clears cursor position", () => {
    const withCursor: NoteInputState = {
      ...initialNoteInputState,
      cursorPosition: { measureIndex: 0, beatPosition: 0, partIndex: 0 },
    };
    const state = noteInputReducer(withCursor, { type: "CLEAR_CURSOR" });
    expect(state.cursorPosition).toBeNull();
  });

  it("TOGGLE_NOTE_INPUT off clears cursor", () => {
    const active: NoteInputState = {
      ...initialNoteInputState,
      active: true,
      cursorPosition: { measureIndex: 1, beatPosition: 2, partIndex: 0 },
    };
    const state = noteInputReducer(active, { type: "TOGGLE_NOTE_INPUT" });
    expect(state.active).toBe(false);
    expect(state.cursorPosition).toBeNull();
  });

  it("TOGGLE_NOTE_INPUT on does not set cursor (set externally)", () => {
    const state = noteInputReducer(initialNoteInputState, { type: "TOGGLE_NOTE_INPUT" });
    expect(state.active).toBe(true);
    expect(state.cursorPosition).toBeNull();
  });

  it("RESET clears cursor", () => {
    const withCursor: NoteInputState = {
      ...initialNoteInputState,
      active: true,
      cursorPosition: { measureIndex: 3, beatPosition: 0, partIndex: 0 },
    };
    const state = noteInputReducer(withCursor, { type: "RESET" });
    expect(state.cursorPosition).toBeNull();
  });
});

// ─── Cursor command tests ────

describe("computeUsedBeats", () => {
  it("returns 0 for empty sequence", () => {
    const score = makeScore(2);
    // Overwrite first measure with empty sequence
    score.parts[0]!.measures[0]!.sequences = [{ content: [] }];
    expect(computeUsedBeats(score, 0, 0, 0)).toBe(0);
  });

  it("returns correct beats for a measure with content", () => {
    const score = makeScoreWithNotes();
    // Two quarters + half = 4 beats
    expect(computeUsedBeats(score, 0, 0, 0)).toBe(4);
  });

  it("returns 0 for nonexistent voice", () => {
    const score = makeScore(1);
    expect(computeUsedBeats(score, 0, 0, 5)).toBe(0);
  });
});

describe("getActiveTimeSignature", () => {
  it("returns time sig from current measure", () => {
    const score = makeScore(2, 3, 4);
    const ts = getActiveTimeSignature(score, 0);
    expect(ts).toEqual({ count: 3, unit: 4 });
  });

  it("inherits time sig from earlier measure", () => {
    const score = makeScore(3, 6, 8);
    const ts = getActiveTimeSignature(score, 2);
    expect(ts).toEqual({ count: 6, unit: 8 });
  });

  it("returns default 4/4 if no time sig found", () => {
    const score = {
      global: { measures: [{}] },
      parts: [{ measures: [{ sequences: [] }] }],
    } as unknown as Score;
    const ts = getActiveTimeSignature(score, 0);
    expect(ts).toEqual({ count: 4, unit: 4 });
  });
});

describe("computeEndOfContentCursor", () => {
  it("returns start of first measure for empty score", () => {
    const score = makeScore(2);
    score.parts[0]!.measures[0]!.sequences = [{ content: [] }];
    score.parts[0]!.measures[1]!.sequences = [{ content: [] }];
    const cursor = computeEndOfContentCursor(score, 0, 0);
    expect(cursor).toEqual({ measureIndex: 0, beatPosition: 0, partIndex: 0 });
  });

  it("returns end of content in partially filled measure", () => {
    const score = makeScoreWithNotes();
    // First measure has 4 beats (full), so cursor should go to start of next measure
    const cursor = computeEndOfContentCursor(score, 0, 0);
    expect(cursor.measureIndex).toBe(1);
    expect(cursor.beatPosition).toBe(0);
  });
});

describe("advanceCursor", () => {
  it("advances within a measure", () => {
    const score = makeScore(2);
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 0, partIndex: 0 };
    const result = advanceCursor(score, cursor, 1);
    expect(result).toEqual({ measureIndex: 0, beatPosition: 1, partIndex: 0 });
  });

  it("advances across measure boundary", () => {
    const score = makeScore(3);
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 3, partIndex: 0 };
    const result = advanceCursor(score, cursor, 2); // 3 + 2 = 5, exceeds 4
    expect(result.measureIndex).toBe(1);
    expect(result.beatPosition).toBeCloseTo(1);
  });

  it("advances past end of last measure for auto-append", () => {
    const score = makeScore(1);
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 3, partIndex: 0 };
    const result = advanceCursor(score, cursor, 10);
    // Cursor advances past the end — note entry auto-appends measures
    expect(result.measureIndex).toBe(1);
    expect(result.beatPosition).toBeCloseTo(9);
  });

  it("handles exact measure fill", () => {
    const score = makeScore(2);
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 2, partIndex: 0 };
    const result = advanceCursor(score, cursor, 2);
    expect(result.measureIndex).toBe(1); // wraps to next measure
    expect(result.beatPosition).toBe(0);
  });
});

describe("moveCursorLeft", () => {
  it("moves back within measure", () => {
    const score = makeScore(2);
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 2, partIndex: 0 };
    const result = moveCursorLeft(score, cursor, 1);
    expect(result).toEqual({ measureIndex: 0, beatPosition: 1, partIndex: 0 });
  });

  it("crosses measure boundary backwards", () => {
    const score = makeScore(3);
    const cursor: CursorPosition = { measureIndex: 1, beatPosition: 0.5, partIndex: 0 };
    const result = moveCursorLeft(score, cursor, 1);
    expect(result.measureIndex).toBe(0);
    expect(result.beatPosition).toBeCloseTo(3.5);
  });

  it("clamps at start of score", () => {
    const score = makeScore(2);
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 0.5, partIndex: 0 };
    const result = moveCursorLeft(score, cursor, 2);
    expect(result.measureIndex).toBe(0);
    expect(result.beatPosition).toBe(0);
  });
});

describe("moveCursorRight", () => {
  it("moves forward within measure", () => {
    const score = makeScore(2);
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 1, partIndex: 0 };
    const result = moveCursorRight(score, cursor, 1);
    expect(result).toEqual({ measureIndex: 0, beatPosition: 2, partIndex: 0 });
  });

  it("crosses measure boundary forwards", () => {
    const score = makeScore(3);
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 3.5, partIndex: 0 };
    const result = moveCursorRight(score, cursor, 1);
    expect(result.measureIndex).toBe(1);
    expect(result.beatPosition).toBeCloseTo(0.5);
  });
});

describe("event-based cursor travel", () => {
  it("moves to previous event boundary", () => {
    const score = makeScoreWithNotes();
    const cursor: CursorPosition = { measureIndex: 1, beatPosition: 1, partIndex: 0 };
    const result = moveCursorToPreviousEvent(score, cursor, 0);
    expect(result).toEqual({ measureIndex: 1, beatPosition: 0, partIndex: 0 });
  });

  it("moves to next event boundary", () => {
    const score = makeScoreWithNotes();
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 0, partIndex: 0 };
    const result = moveCursorToNextEvent(score, cursor, 0);
    expect(result).toEqual({ measureIndex: 0, beatPosition: 1, partIndex: 0 });
  });

  it("jumps to next measure start", () => {
    const score = makeScoreWithNotes();
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 3, partIndex: 0 };
    const result = moveCursorToNextMeasure(score, cursor);
    expect(result).toEqual({ measureIndex: 1, beatPosition: 0, partIndex: 0 });
  });
});

// ─── staffIndex preservation tests ────

describe("cursor commands preserve staffIndex", () => {
  it("advanceCursor preserves staffIndex within measure", () => {
    const score = makeScore(2);
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 0, partIndex: 0, staffIndex: 1 };
    const result = advanceCursor(score, cursor, 1);
    expect(result.staffIndex).toBe(1);
  });

  it("advanceCursor preserves staffIndex across measure boundary", () => {
    const score = makeScore(3);
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 3, partIndex: 0, staffIndex: 2 };
    const result = advanceCursor(score, cursor, 2);
    expect(result.staffIndex).toBe(2);
  });

  it("advanceCursor preserves staffIndex past end of score", () => {
    const score = makeScore(1);
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 3, partIndex: 0, staffIndex: 1 };
    const result = advanceCursor(score, cursor, 10);
    expect(result.staffIndex).toBe(1);
  });

  it("moveCursorLeft preserves staffIndex", () => {
    const score = makeScore(2);
    const cursor: CursorPosition = { measureIndex: 1, beatPosition: 0.5, partIndex: 0, staffIndex: 1 };
    const result = moveCursorLeft(score, cursor, 1);
    expect(result.staffIndex).toBe(1);
  });

  it("moveCursorRight preserves staffIndex", () => {
    const score = makeScore(2);
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 1, partIndex: 0, staffIndex: 1 };
    const result = moveCursorRight(score, cursor, 1);
    expect(result.staffIndex).toBe(1);
  });

  it("moveCursorToPreviousEvent preserves staffIndex", () => {
    const score = makeScoreWithNotes();
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 1, partIndex: 0, staffIndex: 1 };
    const result = moveCursorToPreviousEvent(score, cursor, 0);
    expect(result.staffIndex).toBe(1);
    expect(result.beatPosition).toBe(0);
  });

  it("moveCursorToNextEvent preserves staffIndex", () => {
    const score = makeScoreWithNotes();
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 0, partIndex: 0, staffIndex: 1 };
    const result = moveCursorToNextEvent(score, cursor, 0);
    expect(result.staffIndex).toBe(1);
    expect(result.beatPosition).toBe(1);
  });

  it("moveCursorToNextMeasure preserves staffIndex", () => {
    const score = makeScoreWithNotes();
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 2, partIndex: 0, staffIndex: 1 };
    const result = moveCursorToNextMeasure(score, cursor);
    expect(result.staffIndex).toBe(1);
    expect(result.measureIndex).toBe(1);
  });

  it("staffIndex undefined when not provided", () => {
    const score = makeScore(2);
    const cursor: CursorPosition = { measureIndex: 0, beatPosition: 0, partIndex: 0 };
    const result = advanceCursor(score, cursor, 1);
    expect(result.staffIndex).toBeUndefined();
  });
});
