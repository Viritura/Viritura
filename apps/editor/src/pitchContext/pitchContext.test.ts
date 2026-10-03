import { afterEach, describe, expect, it, vi } from "vitest";
import { pitchToMidi, type Score } from "@viritura/core";
import { resolveDisplayKeyFifths, resolveDisplayTransposition } from "./index";
import { resolveEntryPitch, resolveWrittenPitchFromSounding } from "../commands/transposeCommands";
import { handleMidiNoteEntry, handleNoteEntry } from "../keyboard/noteEntryHandler";
import type { KeyboardHandlerContext } from "../keyboard/types";
import { useNoteInputStore, type NoteInputState } from "../store/noteInputStore";

function changingScore(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ time: { count: 4, unit: 4 }, key: { fifths: 0 } }, {}, {}] },
    scores: [{ useWritten: false }, { useWritten: true }],
    parts: [
      {
        transposition: { interval: { halfSteps: -12, staffDistance: -7 }, prefersWrittenPitches: true },
        _x: {
          viritura: {
            initialInstrument: "piccolo",
            instruments: {
              piccolo: { instrumentId: "wind.flutes.flute.piccolo" },
              clarinet: {
                instrumentId: "wind.reed.clarinet",
                transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
              },
              flute: { instrumentId: "wind.flutes.flute" },
            },
          },
        },
        measures: [
          { sequences: [{ content: [] }] },
          { sequences: [{ content: [] }], instrumentChanges: [{ instrument: "clarinet" }] },
          { sequences: [{ content: [] }], instrumentChanges: [{ instrument: "flute" }] },
        ],
      },
    ],
  };
}

function entryHarness(initialScore: Score, measureIndex = 1, scoreIndex = 1) {
  let score = initialScore;
  const input: NoteInputState = {
    ...useNoteInputStore.getState(),
    active: true,
    currentAccidental: null,
    lastPitch: { step: "C", octave: 5 } as const,
    cursorPosition: { partIndex: 0, staffIndex: 0, measureIndex, beatPosition: 0 },
  };
  const setLastPitch = vi.fn();
  const setCursor = vi.fn();
  const previewPitch = vi.fn();
  const ctx: KeyboardHandlerContext = {
    getScore: () => score,
    getNoteInput: () => input,
    getSelection: () => ({ kind: "none" }),
    getNavIndex: () => null,
    getConfig: () => ({
      canvasRef: { current: null },
      currentZoom: 1,
      selectedScoreIndex: scoreIndex,
      onNewScore: vi.fn(),
      onShowHelp: vi.fn(),
      onOpenFile: vi.fn(),
      onSave: vi.fn(),
      onSaveAs: vi.fn(),
      onCopy: vi.fn(),
      onCut: vi.fn(),
      onPaste: vi.fn(),
    }),
    updateScore: (next) => {
      score = next;
    },
    commitPatches: vi.fn(),
    selectElement: vi.fn(),
    selectRange: vi.fn(),
    extendSelection: vi.fn(),
    clearSelection: vi.fn(),
    toggleNoteInput: vi.fn(),
    setDuration: vi.fn(),
    toggleRest: vi.fn(),
    toggleDot: vi.fn(),
    incrementDot: vi.fn(),
    setGraceType: vi.fn(),
    toggleGraceActive: vi.fn(),
    toggleSlur: vi.fn(),
    toggleTie: vi.fn(),
    setLastPitch,
    setCursor,
    setSlurStart: vi.fn(),
    clearSlurStart: vi.fn(),
    setVoice: vi.fn(),
    setAccidental: vi.fn(),
    toggleChordLock: vi.fn(),
    setChordLock: vi.fn(),
    setRhythmSource: vi.fn(),
    previewPitch,
    undo: vi.fn(),
    redo: vi.fn(),
  };
  return { ctx, input, setLastPitch, setCursor, previewPitch, getScore: () => score };
}

afterEach(() => vi.useRealTimers());

describe("per-position editor pitch context", () => {
  it("uses active instrument defaults and clears the initial piccolo interval on return to flute", () => {
    const score = changingScore();
    expect(resolveEntryPitch({ step: "C", octave: 5 }, score, 0, 0, 0).sounding).toEqual({ step: "C", octave: 6 });
    expect(resolveEntryPitch({ step: "C", octave: 5 }, score, 0, 0, 1, [0, 1], 1).sounding).toEqual({
      step: "B",
      octave: 4,
      alter: -1,
    });
    expect(resolveEntryPitch({ step: "C", octave: 5 }, score, 0, 0, 2, [0, 1], 1).sounding).toEqual({
      step: "C",
      octave: 5,
    });
    expect(score.parts[0]!.transposition?.interval.halfSteps).toBe(-12);
  });

  it("respects concert display and the active state's prefersWrittenPitches, not the initial preference", () => {
    const score = changingScore();
    expect(resolveDisplayTransposition(score, 0, 1)).toBeUndefined();
    score.parts[0]!.measures[1]!.instrumentChanges![0]!.transposition = {
      interval: { halfSteps: 2, staffDistance: 1 },
      prefersWrittenPitches: true,
    };
    expect(resolveEntryPitch({ step: "C", octave: 5 }, score, 0, 0, 1).sounding).toEqual({
      step: "B",
      octave: 4,
      alter: -1,
    });
  });

  it("applies positioned transposition changes at their exact boundary and carries state onward", () => {
    const score = changingScore();
    score.parts[0]!.measures[1]!.instrumentChanges = [
      {
        position: { fraction: [1, 2] },
        transposition: { interval: { halfSteps: 2, staffDistance: 1 } },
      },
    ];
    expect(resolveEntryPitch({ step: "C", octave: 5 }, score, 0, 0, 1, [1, 4], 1).sounding.octave).toBe(6);
    const pair = resolveEntryPitch({ step: "C", octave: 5 }, score, 0, 0, 1, [1, 2], 1);
    expect(pair.sounding).toEqual({ step: "B", octave: 4, alter: -1 });
    expect(resolveWrittenPitchFromSounding(pair.sounding, score, 0, 0, 1, [1, 2], 1)).toEqual(pair.written);
    score.parts[0]!.measures[2]!.instrumentChanges = [];
    expect(resolveDisplayTransposition(score, 0, 2, [0, 1], 1)?.interval.halfSteps).toBe(2);
  });

  it("uses diatonic spelling and the active key flip for displayed keys", () => {
    expect(resolveDisplayKeyFifths(0, { interval: { halfSteps: 3, staffDistance: 2 } })).toBe(-3);
    expect(resolveDisplayKeyFifths(5, { interval: { halfSteps: 2, staffDistance: 1 }, keyFifthsFlipAt: 6 })).toBe(-5);
    expect(resolveDisplayKeyFifths(-2, { interval: { halfSteps: -12, staffDistance: -7 } })).toBe(-2);
  });

  it("enters written C5 after a clarinet switch as sounding Bb4 and previews that pitch exactly once", () => {
    vi.useFakeTimers();
    const harness = entryHarness(changingScore());
    harness.input.currentAccidental = "natural";
    handleNoteEntry("C", false, harness.ctx);
    vi.runAllTimers();
    const pitch = harness.getScore().parts[0]!.measures[1]!.sequences[0]!.content[0]!.notes![0]!.pitch;
    expect(pitch).toEqual({ step: "B", octave: 4, alter: -1 });
    expect(harness.previewPitch).toHaveBeenCalledExactlyOnceWith(pitch, 0, { measureIndex: 1, fraction: [0, 1] });
    expect(pitchToMidi(harness.previewPitch.mock.calls[0]![0])).toBe(70);
    expect(harness.setLastPitch).toHaveBeenCalledWith({ step: "C", octave: 5, alter: 0 });
    expect(harness.setCursor).toHaveBeenCalledWith({ partIndex: 0, staffIndex: 0, measureIndex: 1, beatPosition: 1 });
  });

  it("keeps concert entry unchanged after the switch", () => {
    vi.useFakeTimers();
    const harness = entryHarness(changingScore(), 1, 0);
    handleNoteEntry("C", false, harness.ctx);
    vi.runAllTimers();
    expect(harness.getScore().parts[0]!.measures[1]!.sequences[0]!.content[0]!.notes![0]!.pitch).toEqual({
      step: "C",
      octave: 5,
    });
    expect(harness.previewPitch).toHaveBeenCalledExactlyOnceWith({ step: "C", octave: 5 }, 0, {
      measureIndex: 1,
      fraction: [0, 1],
    });
  });

  it("uses the active written key's C-sharp by default instead of the initial octave transposition", () => {
    vi.useFakeTimers();
    const harness = entryHarness(changingScore());
    handleNoteEntry("C", false, harness.ctx);
    vi.runAllTimers();
    expect(harness.getScore().parts[0]!.measures[1]!.sequences[0]!.content[0]!.notes![0]!.pitch).toEqual({
      step: "B",
      octave: 4,
    });
    expect(harness.setLastPitch).toHaveBeenCalledWith({ step: "C", octave: 5, alter: 1 });
    expect(harness.previewPitch).toHaveBeenCalledExactlyOnceWith({ step: "B", octave: 4 }, 0, {
      measureIndex: 1,
      fraction: [0, 1],
    });
  });

  it("previews piccolo's sounding octave once while retaining written octave memory", () => {
    vi.useFakeTimers();
    const harness = entryHarness(changingScore(), 0, 0);
    handleNoteEntry("C", false, harness.ctx);
    vi.runAllTimers();
    expect(harness.previewPitch).toHaveBeenCalledExactlyOnceWith({ step: "C", octave: 6 }, 0, {
      measureIndex: 0,
      fraction: [0, 1],
    });
    expect(harness.setLastPitch).toHaveBeenCalledWith({ step: "C", octave: 5 });
  });

  it("enters a key-default flat using the active transposition's enharmonic flip", () => {
    vi.useFakeTimers();
    const score = changingScore();
    score.global.measures[0]!.key = { fifths: 5 };
    score.parts[0]!.measures[1]!.instrumentChanges![0]!.transposition = {
      interval: { halfSteps: 2, staffDistance: 1 },
      keyFifthsFlipAt: 6,
    };
    const harness = entryHarness(score);
    handleNoteEntry("B", false, harness.ctx);
    vi.runAllTimers();
    expect(harness.setLastPitch).toHaveBeenCalledWith({ step: "B", octave: 4, alter: -1 });
    expect(harness.previewPitch).toHaveBeenCalledExactlyOnceWith({ step: "A", octave: 4, alter: -1 }, 0, {
      measureIndex: 1,
      fraction: [0, 1],
    });
  });

  it("recovers written octave memory for MIDI entry from the active clarinet rather than the initial piccolo", () => {
    const harness = entryHarness(changingScore());
    handleMidiNoteEntry(60, harness.ctx);
    expect(harness.setLastPitch).toHaveBeenCalledWith({ step: "D", octave: 4 });
    expect(pitchToMidi(harness.getScore().parts[0]!.measures[1]!.sequences[0]!.content[0]!.notes![0]!.pitch)).toBe(60);
  });
});
