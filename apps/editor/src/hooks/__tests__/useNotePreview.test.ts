import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { parseChordSymbolText, pitchToMidi } from "@viritura/core";
import type { Score } from "@viritura/core";
import { resolveEventFromSubElement, getNoteEventAtLocation, extractNoteIndex } from "../../score/ElementPath";
import { parseElementType } from "../../score/elementTypes";
import { midiToFrequency } from "../../hooks/NotePreviewEngine";
import { resetSelectionStore, useSelectionStore } from "../../store/selectionStore";
import { useNotePreview } from "../useNotePreview";

const { useDocumentMock, previewNote, previewChord } = vi.hoisted(() => ({
  useDocumentMock: vi.fn<() => { score: Score }>(),
  previewNote: vi.fn(),
  previewChord: vi.fn(),
}));

vi.mock("../../store/DocumentContext", () => ({
  useDocument: useDocumentMock,
}));

vi.mock("@viritura/playback", () => ({
  usePlaybackActions: () => ({ previewNote, previewChord }),
}));

/**
 * Tests for the note preview resolution logic:
 * element ID → event location → note pitch → MIDI → frequency.
 *
 * This validates the full pipeline that useNotePreview uses
 * to determine what sound to play when a note is clicked.
 */

function makeScore(): Score {
  return {
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
                content: [
                  {
                    type: "event" as const,
                    id: "ev1",
                    duration: { base: "quarter" as const },
                    notes: [{ pitch: { step: "C" as const, octave: 4 as const } }],
                  },
                  {
                    type: "event" as const,
                    id: "ev2",
                    duration: { base: "quarter" as const },
                    notes: [
                      { pitch: { step: "C" as const, octave: 4 as const } },
                      { pitch: { step: "E" as const, octave: 4 as const } },
                      { pitch: { step: "G" as const, octave: 4 as const } },
                    ],
                  },
                  {
                    type: "event" as const,
                    id: "ev3",
                    duration: { base: "quarter" as const },
                    rest: {},
                  },
                  {
                    type: "event" as const,
                    id: "ev4",
                    duration: { base: "quarter" as const },
                    notes: [{ pitch: { step: "F" as const, octave: 4 as const, alter: 1 } }],
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
                    type: "event" as const,
                    id: "ev5",
                    duration: { base: "whole" as const },
                    notes: [{ pitch: { step: "A" as const, octave: 3 as const } }],
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

describe("Note preview resolution pipeline", () => {
  const score = makeScore();

  describe("element type detection", () => {
    it("identifies event elements", () => {
      expect(parseElementType("p0/m0/s0/ev1")).toBe("event");
    });

    it("identifies notehead elements", () => {
      expect(parseElementType("p0/m0/s0/ev2/n1")).toBe("note");
    });

    it("identifies rest events as events", () => {
      expect(parseElementType("p0/m0/s0/ev3")).toBe("event");
    });
  });

  describe("event resolution from element IDs", () => {
    it("resolves a simple event ID to location", () => {
      const loc = resolveEventFromSubElement("p0/m0/s0/ev1", score);
      expect(loc).toEqual({
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 0,
        eventIndex: 0,
      });
    });

    it("resolves a notehead sub-element to parent event", () => {
      const loc = resolveEventFromSubElement("p0/m0/s0/ev2/n1", score);
      expect(loc).toEqual({
        partIndex: 0,
        measureIndex: 0,
        sequenceIndex: 0,
        eventIndex: 1,
        noteIndex: 1,
      });
    });

    it("resolves event in second measure", () => {
      const loc = resolveEventFromSubElement("p0/m1/s0/ev5", score);
      expect(loc).toEqual({
        partIndex: 0,
        measureIndex: 1,
        sequenceIndex: 0,
        eventIndex: 0,
      });
    });
  });

  describe("pitch extraction from events", () => {
    it("gets single note pitch from event", () => {
      const loc = resolveEventFromSubElement("p0/m0/s0/ev1", score);
      expect(loc).not.toBeNull();
      const event = getNoteEventAtLocation(score, loc!);
      expect(event).toBeDefined();
      expect(event!.notes).toHaveLength(1);
      expect(event!.notes![0]!.pitch).toEqual({ step: "C", octave: 4 });
    });

    it("gets all chord pitches", () => {
      const loc = resolveEventFromSubElement("p0/m0/s0/ev2", score);
      const event = getNoteEventAtLocation(score, loc!);
      expect(event!.notes).toHaveLength(3);
      const pitches = event!.notes!.map((n) => n.pitch);
      expect(pitches).toEqual([
        { step: "C", octave: 4 },
        { step: "E", octave: 4 },
        { step: "G", octave: 4 },
      ]);
    });

    it("extracts specific note index from notehead ID", () => {
      expect(extractNoteIndex("p0/m0/s0/ev2/n0")).toBe(0);
      expect(extractNoteIndex("p0/m0/s0/ev2/n1")).toBe(1);
      expect(extractNoteIndex("p0/m0/s0/ev2/n2")).toBe(2);
      expect(extractNoteIndex("p0/m0/s0/ev1")).toBeUndefined();
    });

    it("returns rest events (no notes to play)", () => {
      const loc = resolveEventFromSubElement("p0/m0/s0/ev3", score);
      const event = getNoteEventAtLocation(score, loc!);
      expect(event).toBeDefined();
      expect(event!.rest).toBeDefined();
      expect(event!.notes).toBeUndefined();
    });

    it("handles altered pitches (F#4)", () => {
      const loc = resolveEventFromSubElement("p0/m0/s0/ev4", score);
      const event = getNoteEventAtLocation(score, loc!);
      expect(event!.notes![0]!.pitch).toEqual({ step: "F", octave: 4, alter: 1 });
    });
  });

  describe("MIDI conversion", () => {
    it("C4 → MIDI 60", () => {
      expect(pitchToMidi({ step: "C", octave: 4 })).toBe(60);
    });

    it("A4 → MIDI 69", () => {
      expect(pitchToMidi({ step: "A", octave: 4 })).toBe(69);
    });

    it("F#4 → MIDI 66", () => {
      expect(pitchToMidi({ step: "F", octave: 4, alter: 1 })).toBe(66);
    });

    it("Bb3 → MIDI 58", () => {
      expect(pitchToMidi({ step: "B", octave: 3, alter: -1 })).toBe(58);
    });

    it("C major chord → MIDI [60, 64, 67]", () => {
      const midiNotes = [
        pitchToMidi({ step: "C", octave: 4 }),
        pitchToMidi({ step: "E", octave: 4 }),
        pitchToMidi({ step: "G", octave: 4 }),
      ];
      expect(midiNotes).toEqual([60, 64, 67]);
    });
  });

  describe("full pipeline: element ID → frequency", () => {
    it("clicking single note → correct frequency", () => {
      const loc = resolveEventFromSubElement("p0/m0/s0/ev1", score);
      const event = getNoteEventAtLocation(score, loc!);
      const midi = pitchToMidi(event!.notes![0]!.pitch);
      const freq = midiToFrequency(midi);
      expect(midi).toBe(60);
      expect(freq).toBeCloseTo(261.63, 1);
    });

    it("clicking notehead in chord → correct single frequency", () => {
      const elementId = "p0/m0/s0/ev2/n1"; // E4
      const noteIdx = extractNoteIndex(elementId);
      const loc = resolveEventFromSubElement(elementId, score);
      const event = getNoteEventAtLocation(score, loc!);
      const midi = pitchToMidi(event!.notes![noteIdx!]!.pitch);
      const freq = midiToFrequency(midi);
      expect(midi).toBe(64); // E4
      expect(freq).toBeCloseTo(329.63, 1);
    });

    it("clicking chord → all frequencies", () => {
      const loc = resolveEventFromSubElement("p0/m0/s0/ev2", score);
      const event = getNoteEventAtLocation(score, loc!);
      const freqs = event!.notes!.map((n) => midiToFrequency(pitchToMidi(n.pitch)));
      expect(freqs[0]).toBeCloseTo(261.63, 1); // C4
      expect(freqs[1]).toBeCloseTo(329.63, 1); // E4
      expect(freqs[2]).toBeCloseTo(392.0, 1); // G4
    });
  });
});

describe("useNotePreview chord-symbol selection", () => {
  const chordIds = ["g/m0/chord0", "g/m0/chord0/p0/staff0", "m0/chord0", "m0/chord0/p0/staff0"];
  let score: Score;

  function select(elementId: string): void {
    act(() => {
      useSelectionStore.getState()._dispatch({ type: "SELECT_ELEMENT", elementId });
    });
  }

  function expectNoAudition(): void {
    expect(previewNote).not.toHaveBeenCalled();
    expect(previewChord).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetSelectionStore();
    score = makeScore();
    score.global.measures[0]!.chordSymbols = [parseChordSymbolText("C", { fraction: [0, 1] })];
    useDocumentMock.mockReturnValue({ score });
  });

  afterEach(() => {
    cleanup();
    resetSelectionStore();
  });

  it.each(chordIds)("does not audition auto-selection or re-selection of %s", (elementId) => {
    renderHook(() => useNotePreview());

    select(elementId);
    expectNoAudition();

    select(elementId);
    expectNoAudition();
  });

  it.each(chordIds)("does not audition selected %s on a score rerender", (elementId) => {
    const { rerender } = renderHook(() => useNotePreview());
    select(elementId);

    useDocumentMock.mockReturnValue({ score: structuredClone(score) });
    rerender();
    expectNoAudition();
  });

  it.each(chordIds)("does not audition invalid authored chord typing at %s", (elementId) => {
    const { rerender } = renderHook(() => useNotePreview());
    select(elementId);

    for (const rawText of ["", "H", "H7", "Cgarbage"]) {
      const editedScore = structuredClone(score);
      editedScore.global.measures[0]!.chordSymbols = [parseChordSymbolText(rawText, { fraction: [0, 1] })];
      useDocumentMock.mockReturnValue({ score: editedScore });
      rerender();
      expectNoAudition();

      select(elementId);
      expectNoAudition();
    }
  });

  it("still auditions note selection, but not a subsequent chord-symbol selection", () => {
    renderHook(() => useNotePreview());

    select("p0/m0/s0/ev1/n0");
    expect(previewNote).toHaveBeenCalledExactlyOnceWith(60, 0, 80, 400);
    expect(previewChord).not.toHaveBeenCalled();

    previewNote.mockClear();
    select("g/m0/chord0");
    expectNoAudition();
  });
});
