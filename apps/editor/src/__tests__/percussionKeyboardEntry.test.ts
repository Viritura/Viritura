/**
 * Keyboard note entry on unpitched-percussion staves.
 *
 * Entry must resolve the typed letter to a kit component rather than a pitch.
 * A pitched note on a percussion part is wrong twice over: it renders at a
 * clef-derived line instead of the drum's mapped line, and playback sends the
 * raw chromatic number to the GM drum channel, where a typed "G" (MIDI 67)
 * sounds as High Agogo instead of the mapped drum.
 */

import { describe, expect, it, vi } from "vitest";
import type { Score } from "@viritura/core";
import { generateTimeline } from "@viritura/midi";
import { handleNoteEntry } from "../keyboard/noteEntryHandler";
import type { KeyboardHandlerContext } from "../keyboard/types";

/** Snare on the middle line (the single-line-staff shape from the catalog). */
function makeSnareScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
      sounds: { "snare-sound": { midiNumber: 38 } },
    },
    parts: [
      {
        name: "Snare Drum",
        kit: { hit: { staffPosition: 0, sound: "snare-sound" } },
        measures: [{ sequences: [{ content: [] }] }],
      },
    ],
  } as unknown as Score;
}

/** A multi-drum kit: kick below the staff, snare on the middle line. */
function makeDrumKitScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [{ time: { count: 4, unit: 4 } }],
      sounds: { "kick-sound": { midiNumber: 36 }, "snare-sound": { midiNumber: 38 } },
    },
    parts: [
      {
        name: "Drum Kit",
        kit: {
          kick: { staffPosition: -4, sound: "kick-sound" },
          snare: { staffPosition: 0, sound: "snare-sound" },
        },
        measures: [{ sequences: [{ content: [] }] }],
      },
    ],
  } as unknown as Score;
}

function makeContext(getScore: () => Score, setScore: (next: Score) => void, overrides: Record<string, unknown> = {}) {
  const previewMidi = vi.fn();
  const previewPitch = vi.fn();
  const context = {
    getScore,
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
      ...overrides,
    }),
    getConfig: () => ({ selectedScoreIndex: 0 }),
    updateScore: (next: Score) => setScore(next),
    setCursor: vi.fn(),
    setLastPitch: vi.fn(),
    setAccidental: vi.fn(),
    previewPitch,
    previewMidi,
  } as unknown as KeyboardHandlerContext;
  return { context, previewMidi, previewPitch };
}

function firstEvent(score: Score) {
  return score.parts[0]!.measures[0]!.sequences[0]!.content[0]!;
}

describe("percussion keyboard entry", () => {
  it("enters a kit note rather than a pitch on a percussion part", () => {
    let score = makeSnareScore();
    const { context } = makeContext(
      () => score,
      (next) => {
        score = next;
      },
    );

    handleNoteEntry("G", false, context);

    const event = firstEvent(score);
    // The bug: a pitched G4 here plays MIDI 67 (High Agogo) on the drum channel.
    expect(event.notes).toBeUndefined();
    expect(event.kitNotes).toEqual([{ kitComponent: "hit" }]);
  });

  it("resolves a single-line drum to its mapped component from any letter", () => {
    for (const letter of ["A", "B", "C", "D", "E", "F", "G"]) {
      let score = makeSnareScore();
      const { context } = makeContext(
        () => score,
        (next) => {
          score = next;
        },
      );

      handleNoteEntry(letter, false, context);

      expect(firstEvent(score).kitNotes).toEqual([{ kitComponent: "hit" }]);
    }
  });

  it("previews the mapped drum instead of the typed pitch", () => {
    let score = makeSnareScore();
    const { context, previewMidi, previewPitch } = makeContext(
      () => score,
      (next) => {
        score = next;
      },
    );

    vi.useFakeTimers();
    handleNoteEntry("G", false, context);
    vi.runAllTimers();
    vi.useRealTimers();

    expect(previewMidi).toHaveBeenCalledWith(38, 0);
    expect(previewPitch).not.toHaveBeenCalled();
  });

  it("reads letters as treble clef, so B lands on the middle line", () => {
    // B4 sits on a treble staff's middle line, where the snare is mapped.
    let score = makeDrumKitScore();
    const { context } = makeContext(
      () => score,
      (next) => {
        score = next;
      },
    );

    handleNoteEntry("B", false, context);

    expect(firstEvent(score).kitNotes).toEqual([{ kitComponent: "snare" }]);
  });

  it("maps a letter below the staff to the drum mapped there", () => {
    // E4 is the treble bottom line; the kick sits a space below it.
    let score = makeDrumKitScore();
    const { context } = makeContext(
      () => score,
      (next) => {
        score = next;
      },
      { lastPitch: { step: "E", octave: 4 } },
    );

    handleNoteEntry("D", false, context);

    expect(firstEvent(score).kitNotes).toEqual([{ kitComponent: "kick" }]);
  });

  it("leaves pitched parts on the normal pitch path", () => {
    let score = {
      mnx: { version: 1 },
      global: { measures: [{ time: { count: 4, unit: 4 } }] },
      parts: [{ name: "Piano", measures: [{ sequences: [{ content: [] }] }] }],
    } as unknown as Score;
    const { context } = makeContext(
      () => score,
      (next) => {
        score = next;
      },
    );

    handleNoteEntry("G", false, context);

    const event = firstEvent(score);
    expect(event.kitNotes).toBeUndefined();
    expect(event.notes![0]!.pitch.step).toBe("G");
  });
});

describe("percussion entry playback", () => {
  it("plays the mapped snare, not the GM drum sitting on the typed pitch", () => {
    let score = makeSnareScore();
    const { context } = makeContext(
      () => score,
      (next) => {
        score = next;
      },
    );

    handleNoteEntry("G", false, context);
    const noteOns = generateTimeline(score).events.filter((e) => e.type === "noteOn");

    expect(noteOns).toHaveLength(1);
    // 38 = GM Acoustic Snare. A pitched G4 would have played its raw chromatic
    // number, MIDI 67 — High Agogo on the drum channel.
    expect(noteOns[0]!.midiNote).toBe(38);
    expect(noteOns[0]!.midiNote).not.toBe(67);
  });
});
