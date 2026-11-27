import { describe, expect, it } from "vitest";
import { analyzeHarpPedalCompatibility, type Score } from "../index";

function score(): Score {
  return {
    mnx: { version: 1 },
    global: { measures: [{ id: "m1", time: { count: 4, unit: 4 } }] },
    parts: [
      {
        id: "harp",
        name: "Player",
        staves: 2,
        _x: {
          viritura: {
            instrumentId: "pluck.harp",
            initialInstrument: "harp",
            instruments: {
              harp: { instrumentId: "pluck.harp" },
              flute: { instrumentId: "wind.flutes.flute" },
            },
          },
        },
        measures: [
          {
            harpPedals: [
              {
                id: "setting",
                position: { fraction: [0, 1] },
                tuning: { D: 0, C: 1, B: 0, E: 0, F: 0, G: 0, A: 0 },
              },
            ],
            instrumentChanges: [{ instrument: "flute", position: { fraction: [1, 2] } }],
            sequences: [
              {
                staff: 1,
                content: [
                  {
                    type: "event",
                    id: "before-change",
                    duration: { base: "half" },
                    notes: [{ id: "before-note", pitch: { step: "C", octave: 4 } }],
                  },
                  { type: "space", duration: [1, 4] },
                  {
                    type: "event",
                    id: "after-change",
                    duration: { base: "quarter" },
                    notes: [{ id: "after-note", pitch: { step: "C", octave: 4 } }],
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

describe("harp pedal analysis", () => {
  it("checks active instrument identity at each note onset", () => {
    expect(analyzeHarpPedalCompatibility(score(), 0).issues.map((issue) => issue.eventId)).toEqual(["before-change"]);
  });
});
