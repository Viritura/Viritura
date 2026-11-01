import { parseChordSymbolText } from "@viritura/core";
import type { PrototypeChord } from "../../components/ChordTrackPrototype";

const steps = ["C", "D", "E", "G", "A", "G", "F", "E"];

export const CHORD_TRACK_MNX = JSON.stringify({
  mnx: { version: 1 },
  global: {
    measures: Array.from({ length: 8 }, (_, index) => ({
      ...(index === 0 ? { time: { count: 4, unit: 4 } } : {}),
      ...(index === 4 ? { time: { count: 6, unit: 8 } } : {}),
    })),
  },
  parts: [
    {
      id: "melody",
      name: "Melody",
      measures: Array.from({ length: 8 }, (_, index) => ({
        ...(index === 0 ? { clefs: [{ clef: { sign: "G", staffPosition: -2 } }] } : {}),
        sequences: [
          {
            content: (index < 4
              ? ["eighth", "eighth", "quarter", "half"]
              : Array.from({ length: 6 }, () => "eighth")
            ).map((base, noteIndex) => ({
              duration: { base },
              notes: [{ pitch: { step: steps[(index + noteIndex) % steps.length], octave: 4 } }],
            })),
          },
        ],
      })),
    },
    {
      id: "bass",
      name: "Bass",
      measures: Array.from({ length: 8 }, (_, index) => ({
        ...(index === 0 ? { clefs: [{ clef: { sign: "F", staffPosition: 2 } }] } : {}),
        sequences: [
          {
            content: [
              {
                duration: index < 4 ? { base: "whole" } : { base: "half", dots: 1 },
                notes: [{ pitch: { step: steps[index], octave: 3 } }],
              },
            ],
          },
        ],
      })),
    },
  ],
});

const changes: readonly (readonly [number, number, string])[] = [
  [0, 0, "Cmaj7"],
  [0, 2, "Am7"],
  [1, 0, "Dm7"],
  [1, 2, "G7/B"],
  [2, 0, "C/E"],
  [3, 0, "Fmaj7"],
  [3, 3, "G7"],
  [4, 0, "Am7"],
  [4, 1.5, "Dm7"],
  [5, 0, "G7"],
  [6, 0, "NC"],
  [7, 0, "Cmaj7"],
];

export const MOCK_TRACK_CHORDS: readonly PrototypeChord[] = changes.map(([measureIndex, beat, text]) => ({
  measureIndex,
  symbol: parseChordSymbolText(text, { fraction: [beat * 2, 8] }),
}));
