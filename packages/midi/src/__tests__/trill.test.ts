import { describe, it, expect } from "vitest";
import type { Score } from "@viritura/core";
import { generateTimeline } from "../timeline";

type Step = "C" | "D" | "E" | "F" | "G" | "A" | "B";

/**
 * Build a single-part, single-measure score whose first event carries a trill.
 *
 * @param base       note value of the trilled note (controls how many
 *                   alternations fit at 120 bpm)
 * @param fifths     key signature (circle-of-fifths)
 * @param accidental optional explicit trill accidental override
 */
function buildTrillScore(step: Step, octave: number, base: string, fifths: number, accidental?: number): Score {
  const trill = accidental === undefined ? {} : { accidental };
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          key: { fifths },
          tempos: [{ bpm: 120, value: { base: "quarter" } } as never],
        },
      ],
    },
    parts: [
      {
        id: "p1",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    duration: { base },
                    notes: [{ pitch: { step, octave } }],
                    markings: { trill },
                  },
                ],
              },
            ],
          },
        ],
      } as never,
    ],
  };
}

/** Distinct MIDI pitches that received a noteOn, in first-seen order. */
function noteOnPitchesInOrder(events: { type: string; midiNote: number }[]): number[] {
  const seen: number[] = [];
  for (const e of events) {
    if (e.type === "noteOn" && !seen.includes(e.midiNote)) seen.push(e.midiNote);
  }
  return seen;
}

describe("generateTimeline — trill expansion", () => {
  it("expands a half-note trill into many alternating noteOns", () => {
    // Half note at 120 bpm = 1000 ms; at ~70 ms/note ≈ 14 notes.
    const tl = generateTimeline(buildTrillScore("C", 5, "half", 0));
    const noteOns = tl.events.filter((e) => e.type === "noteOn");
    expect(noteOns.length).toBeGreaterThan(8);
  });

  it("starts on the principal (lower) note", () => {
    const tl = generateTimeline(buildTrillScore("C", 5, "half", 0));
    const firstNoteOn = tl.events.find((e) => e.type === "noteOn")!;
    expect(firstNoteOn.midiNote).toBe(72); // C5
  });

  it("is key-signature aware: C major trill on C goes to D (whole step)", () => {
    const tl = generateTimeline(buildTrillScore("C", 5, "half", 0));
    const pitches = noteOnPitchesInOrder(tl.events);
    expect(pitches).toEqual([72, 74]); // C5, D5
  });

  it("is key-signature aware: G major raises the F auxiliary to F#", () => {
    // Trill on E5 in G major (1 sharp = F#). Upper auxiliary is F → F#.
    const tl = generateTimeline(buildTrillScore("E", 5, "half", 1));
    const pitches = noteOnPitchesInOrder(tl.events);
    expect(pitches).toEqual([76, 78]); // E5, F#5
  });

  it("respects an explicit trill accidental override (non-diatonic)", () => {
    // Trill on C5 in C major, but force a flat auxiliary → D♭5.
    const tl = generateTimeline(buildTrillScore("C", 5, "half", 0, -1));
    const pitches = noteOnPitchesInOrder(tl.events);
    expect(pitches).toEqual([72, 73]); // C5, D♭5
  });

  it("omits the trill on notes too short to be perceptible", () => {
    // 32nd note at 120 bpm = 62.5 ms — too short for even one clean alternation.
    const tl = generateTimeline(buildTrillScore("C", 5, "32nd", 0));
    const noteOns = tl.events.filter((e) => e.type === "noteOn");
    // Falls back to a single plain note.
    expect(noteOns.length).toBe(1);
    expect(noteOns[0]!.midiNote).toBe(72);
  });
});
