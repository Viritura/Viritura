import { describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { handleMidiChordEntry, handleMidiNoteEntry, handleNoteEntry } from "../keyboard/noteEntryHandler";
import type { KeyboardHandlerContext } from "../keyboard/types";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 } }] },
    parts: [
      {
        name: "Piano",
        measures: [
          {
            sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }],
          },
        ],
      },
    ],
  };
}

describe("handleNoteEntry", () => {
  it("inserts the exact MIDI pitch and advances the note-input cursor", () => {
    let score = makeScore();
    const setCursor = vi.fn();
    const setLastPitch = vi.fn();
    const context = {
      getScore: () => score,
      getNoteInput: () => ({
        active: true,
        currentVoice: 1,
        currentDuration: "quarter",
        dotCount: 0,
        currentAccidental: null,
        isRest: false,
        currentGraceType: null,
        lastPitch: null,
        cursorPosition: { measureIndex: 0, beatPosition: 0, partIndex: 0, staffIndex: 0 },
        slurActive: false,
        slurStartEventId: null,
        chordLock: false,
        condensingRouting: null,
      }),
      getConfig: () => ({ selectedScoreIndex: 0 }),
      updateScore: (next: Score) => {
        score = next;
      },
      setCursor,
      setLastPitch,
      setAccidental: vi.fn(),
    } as unknown as KeyboardHandlerContext;

    handleMidiNoteEntry(61, context);

    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch).toEqual({
      step: "C",
      octave: 4,
      alter: 1,
    });
    expect(setLastPitch).toHaveBeenCalledWith({ step: "C", octave: 4, alter: 1 });
    expect(setCursor).toHaveBeenCalledWith({
      measureIndex: 0,
      beatPosition: 1,
      partIndex: 0,
      staffIndex: 0,
    });
  });

  it("spells black-key MIDI input with flats in a flat key signature", () => {
    let score = makeScore();
    score.global.measures[0]!.key = { fifths: -2 };
    const context = {
      getScore: () => score,
      getNoteInput: () => ({
        active: true,
        currentVoice: 1,
        currentDuration: "quarter",
        dotCount: 0,
        currentAccidental: null,
        isRest: false,
        currentGraceType: null,
        lastPitch: null,
        cursorPosition: { measureIndex: 0, beatPosition: 0, partIndex: 0, staffIndex: 0 },
        slurActive: false,
        slurStartEventId: null,
        chordLock: false,
        condensingRouting: null,
      }),
      getConfig: () => ({ selectedScoreIndex: 0 }),
      updateScore: (next: Score) => {
        score = next;
      },
      setCursor: vi.fn(),
      setLastPitch: vi.fn(),
      setAccidental: vi.fn(),
    } as unknown as KeyboardHandlerContext;

    handleMidiNoteEntry(61, context);

    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch).toEqual({
      step: "D",
      octave: 4,
      alter: -1,
    });
  });

  it("commits a released MIDI chord in one score update and advances once", () => {
    let score = makeScore();
    const updateScore = vi.fn((next: Score) => {
      score = next;
    });
    const setCursor = vi.fn();
    const context = {
      getScore: () => score,
      getNoteInput: () => ({
        active: true,
        currentVoice: 1,
        currentDuration: "quarter",
        dotCount: 0,
        currentAccidental: null,
        isRest: false,
        currentGraceType: null,
        lastPitch: null,
        cursorPosition: { measureIndex: 0, beatPosition: 0, partIndex: 0, staffIndex: 0 },
        slurActive: false,
        slurStartEventId: null,
        chordLock: false,
        condensingRouting: null,
      }),
      getConfig: () => ({ selectedScoreIndex: 0 }),
      updateScore,
      setCursor,
      setLastPitch: vi.fn(),
      setAccidental: vi.fn(),
    } as unknown as KeyboardHandlerContext;

    handleMidiChordEntry([67, 60, 64], context);

    expect(updateScore).toHaveBeenCalledTimes(1);
    expect(
      score.parts[0]!.measures[0]!.sequences[0]!.content.filter((event) => event.type === "event" && event.notes),
    ).toHaveLength(1);
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes?.map((note) => note.pitch)).toEqual([
      { step: "C", octave: 4 },
      { step: "E", octave: 4 },
      { step: "G", octave: 4 },
    ]);
    expect(setCursor).toHaveBeenCalledTimes(1);
    expect(setCursor).toHaveBeenCalledWith({
      measureIndex: 0,
      beatPosition: 1,
      partIndex: 0,
      staffIndex: 0,
    });
  });

  it("clears an explicit accidental after inserting a pitched note", () => {
    let score = makeScore();
    const setAccidental = vi.fn();
    const context = {
      getScore: () => score,
      getNoteInput: () => ({
        active: true,
        currentVoice: 1,
        currentDuration: "quarter",
        dotCount: 0,
        currentAccidental: "sharp",
        isRest: false,
        currentGraceType: null,
        lastPitch: null,
        cursorPosition: { measureIndex: 0, beatPosition: 0, partIndex: 0, staffIndex: 0 },
        slurActive: false,
        slurStartEventId: null,
        chordLock: false,
        condensingRouting: null,
      }),
      getConfig: () => ({ selectedScoreIndex: 0 }),
      updateScore: (next: Score) => {
        score = next;
      },
      setCursor: vi.fn(),
      setLastPitch: vi.fn(),
      setAccidental,
      previewPitch: vi.fn(),
    } as unknown as KeyboardHandlerContext;

    handleNoteEntry("F", false, context);

    expect(setAccidental).toHaveBeenCalledWith(null);
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[0]!.notes![0]!.pitch).toMatchObject({
      step: "F",
      alter: 1,
    });
  });

  it("inherits an earlier accidental in the bar after the toolbar clears", () => {
    let score = makeScore();
    score.parts[0]!.measures[0]!.sequences[0] = {
      content: [
        {
          type: "event",
          duration: { base: "quarter" },
          notes: [{ pitch: { step: "F", octave: 4, alter: 1 } }],
        },
      ],
    };
    const context = {
      getScore: () => score,
      getNoteInput: () => ({
        active: true,
        currentVoice: 1,
        currentDuration: "quarter",
        dotCount: 0,
        currentAccidental: null,
        isRest: false,
        currentGraceType: null,
        lastPitch: { step: "F", octave: 4, alter: 1 },
        cursorPosition: { measureIndex: 0, beatPosition: 1, partIndex: 0, staffIndex: 0 },
        slurActive: false,
        slurStartEventId: null,
        chordLock: false,
        condensingRouting: null,
      }),
      getConfig: () => ({ selectedScoreIndex: 0 }),
      updateScore: (next: Score) => {
        score = next;
      },
      setCursor: vi.fn(),
      setLastPitch: vi.fn(),
      setAccidental: vi.fn(),
      previewPitch: vi.fn(),
    } as unknown as KeyboardHandlerContext;

    handleNoteEntry("F", false, context);

    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[1]!.notes![0]!.pitch).toMatchObject({
      step: "F",
      octave: 4,
      alter: 1,
    });
  });

  it("resets automatic accidental inheritance when entry advances across a barline", () => {
    let score = makeScore();
    score.global.measures.push({});
    score.parts[0]!.measures = [
      {
        sequences: [
          {
            content: [
              {
                type: "event",
                duration: { base: "whole" },
                notes: [{ pitch: { step: "F", octave: 4, alter: 1 } }],
              },
            ],
          },
        ],
      },
      { sequences: [{ content: [], fullMeasure: { visualDuration: { base: "whole" } } }] },
    ];
    const context = {
      getScore: () => score,
      getNoteInput: () => ({
        active: true,
        currentVoice: 1,
        currentDuration: "quarter",
        dotCount: 0,
        currentAccidental: null,
        isRest: false,
        currentGraceType: null,
        lastPitch: { step: "F", octave: 4, alter: 1 },
        cursorPosition: { measureIndex: 0, beatPosition: 4, partIndex: 0, staffIndex: 0 },
        slurActive: false,
        slurStartEventId: null,
        chordLock: false,
        condensingRouting: null,
      }),
      getConfig: () => ({ selectedScoreIndex: 0 }),
      updateScore: (next: Score) => {
        score = next;
      },
      setCursor: vi.fn(),
      setLastPitch: vi.fn(),
      setAccidental: vi.fn(),
      previewPitch: vi.fn(),
    } as unknown as KeyboardHandlerContext;

    handleNoteEntry("F", false, context);

    const inserted = score.parts[0]!.measures[1]!.sequences[0]!.content[0]!.notes![0]!.pitch;
    expect(inserted).toMatchObject({ step: "F", octave: 4 });
    expect(inserted.alter).toBeUndefined();
  });

  it("keeps octave memory synchronized with notes stacked by chord lock", () => {
    let score = makeScore();
    const input = {
      active: true,
      currentVoice: 1 as const,
      currentDuration: "quarter" as const,
      dotCount: 0 as const,
      currentAccidental: null,
      isRest: false,
      currentGraceType: null,
      lastPitch: null as import("@viritura/core").Pitch | null,
      cursorPosition: { measureIndex: 0, beatPosition: 0, partIndex: 0, staffIndex: 0 },
      slurActive: false,
      slurStartEventId: null,
      chordLock: false,
      condensingRouting: null,
    };
    const context = {
      getScore: () => score,
      getNoteInput: () => input,
      getConfig: () => ({ selectedScoreIndex: 0 }),
      updateScore: (next: Score) => {
        score = next;
      },
      setCursor: (cursor: typeof input.cursorPosition) => {
        input.cursorPosition = cursor;
      },
      setLastPitch: (pitch: import("@viritura/core").Pitch) => {
        input.lastPitch = pitch;
      },
      setAccidental: vi.fn(),
      previewPitch: vi.fn(),
    } as unknown as KeyboardHandlerContext;

    handleNoteEntry("C", false, context);
    input.chordLock = true;
    handleNoteEntry("B", true, context);
    handleNoteEntry("A", true, context);
    handleNoteEntry("G", true, context);

    const chord = score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
    expect(chord.notes?.map((note) => `${note.pitch.step}${note.pitch.octave}`)).toEqual(["C5", "B5", "A6", "G7"]);
    expect(input.lastPitch).toMatchObject({ step: "G", octave: 7 });

    input.chordLock = false;
    handleNoteEntry("F", false, context);
    expect(score.parts[0]!.measures[0]!.sequences[0]!.content[1]!.notes?.[0]?.pitch).toMatchObject({
      step: "F",
      octave: 7,
    });
  });
});
