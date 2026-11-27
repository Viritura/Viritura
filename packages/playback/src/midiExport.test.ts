import { describe, expect, it } from "vitest";
import type { Score } from "@viritura/core";
import { BasicMIDI } from "spessasynth_core";
import { exportScoreMidi } from "./midiExport";

function makeScore(): Score {
  return {
    mnx: { version: 1 },
    global: {
      measures: [
        {
          time: { count: 4, unit: 4 },
          chordSymbols: [{ root: { step: "C" }, position: { fraction: [0, 1] } }],
        },
      ],
    },
    parts: [
      {
        id: "keyboard.piano",
        name: "Piano",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "C", octave: 4 } }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "wind.flutes.flute",
        name: "Flute",
        measures: [
          {
            sequences: [
              {
                content: [
                  {
                    type: "event",
                    duration: { base: "whole" },
                    notes: [{ pitch: { step: "D", octave: 4 } }],
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

describe("score MIDI export", () => {
  it("exports every instrument without the generated Chords track", () => {
    const result = exportScoreMidi(makeScore());
    const header = new DataView(result.bytes.buffer, result.bytes.byteOffset, result.bytes.byteLength);
    expect(new TextDecoder().decode(result.bytes.slice(0, 4))).toBe("MThd");
    expect(header.getUint16(10)).toBe(3);
    const parsed = BasicMIDI.fromArrayBuffer(new Uint8Array(result.bytes).buffer);
    expect(parsed.tracks).toHaveLength(3);
    expect(parsed.timeDivision).toBe(9600);
    expect(parsed.duration).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });

  it("reports physical MIDI channel exhaustion", () => {
    const score = makeScore();
    score.parts = Array.from({ length: 16 }, (_, index) => ({
      ...structuredClone(score.parts[0]!),
      id: `piano-${index}`,
    }));
    expect(exportScoreMidi(score).warnings.some((warning) => warning.includes("channel capacity exceeded"))).toBe(true);
  });

  it("warns when percussion parts share channel 10", () => {
    const score = makeScore();
    score.global.sounds = { snare: { midiNumber: 38, name: "Snare" } };
    score.parts = score.parts.map((part) => ({
      ...part,
      kit: { snare: { sound: "snare", staffPosition: 0 } },
      measures: [
        {
          sequences: [
            { content: [{ type: "event", duration: { base: "whole" }, kitNotes: [{ kitComponent: "snare" }] }] },
          ],
        },
      ],
    }));
    expect(exportScoreMidi(score).warnings.some((warning) => warning.includes("share MIDI channel 10"))).toBe(true);
  });
});
