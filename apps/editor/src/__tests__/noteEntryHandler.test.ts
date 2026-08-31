import { describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { handleNoteEntry } from "../keyboard/noteEntryHandler";
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
});
