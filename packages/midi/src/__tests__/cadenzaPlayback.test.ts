import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { generateTimeline } from "../timeline";

function note(step: "C" | "D" | "E" | "F" | "G", octave: number, base: "half" | "quarter") {
  return { type: "event" as const, duration: { base }, notes: [{ pitch: { step, octave } }] };
}

describe("generateTimeline - open-meter cadenza", () => {
  it("holds every part until the longest cadenza sequence has finished", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            time: { count: 2, unit: 4, display: "senzaMisura" },
            tempos: [{ bpm: 120, value: { base: "quarter" } } as never],
          },
          {},
        ],
      },
      parts: [
        {
          id: "solo",
          measures: [
            {
              sequences: [
                {
                  content: [
                    note("C", 5, "half"),
                    note("D", 5, "quarter"),
                    note("E", 5, "quarter"),
                    note("F", 5, "quarter"),
                    note("G", 5, "quarter"),
                    note("C", 6, "quarter"),
                    note("D", 6, "quarter"),
                    note("E", 6, "quarter"),
                  ],
                },
              ],
            },
            { sequences: [{ content: [note("C", 6, "half")] }] },
          ],
        },
        {
          id: "tutti",
          measures: [
            { sequences: [{ content: [{ ...note("C", 3, "half"), fermata: {} }] }] },
            { sequences: [{ content: [note("C", 3, "half")] }] },
          ],
        },
      ],
    };

    const timeline = generateTimeline(score);
    const soloReturn = timeline.events.filter((event) => event.type === "noteOn" && event.midiNote === 84).at(-1)!;
    const tuttiReturn = timeline.events.filter((event) => event.type === "noteOn" && event.midiNote === 48).at(-1)!;

    // Nine written quarter-note beats at q = 120 occupy 4.5 seconds. The
    // fermata is visual cadenza notation, not an additional fixed multiplier.
    expect(soloReturn.time).toBeCloseTo(4.5, 1);
    expect(tuttiReturn.time).toBeCloseTo(4.5, 1);
  });
});

describe("generateTimeline - pickup measure", () => {
  it("starts measure one after the written duration of measure zero", () => {
    const score: Score = {
      mnx: { version: 1 },
      global: {
        measures: [
          {
            number: 0,
            time: { count: 2, unit: 4 },
            tempos: [{ bpm: 154, value: { base: "quarter" } } as never],
          },
          {},
        ],
      },
      parts: [
        {
          id: "part",
          measures: [
            { sequences: [{ content: [note("G", 4, "quarter")] }] },
            { sequences: [{ content: [note("C", 5, "half")] }] },
          ],
        },
      ],
    };

    const timeline = generateTimeline(score);
    const measureOneNote = timeline.events.find((event) => event.type === "noteOn" && event.midiNote === 72)!;

    expect(timeline.measureStartBeats).toEqual([0, 1]);
    expect(timeline.measureStartTimes[1]).toBeCloseTo(60 / 154, 5);
    expect(measureOneNote.time).toBeCloseTo(60 / 154, 1);
    expect(timeline.measureTimeSignatures[0]).toEqual({ count: 2, unit: 4 });
  });
});
