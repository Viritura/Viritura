import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Rhythm & Beaming/Tuplet Display",
  component: ScorePreview,
};

export default meta;

export const TripletEighths: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 } }] },
        parts: [
          {
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: [
                      {
                        type: "tuplet",
                        inner: { multiple: 3, duration: { base: "eighth" } },
                        outer: { multiple: 2, duration: { base: "eighth" } },
                        content: [
                          { duration: { base: "eighth" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                          { duration: { base: "eighth" }, notes: [{ pitch: { step: "D", octave: 5 } }] },
                          { duration: { base: "eighth" }, notes: [{ pitch: { step: "E", octave: 5 } }] },
                        ],
                      },
                      {
                        type: "tuplet",
                        inner: { multiple: 3, duration: { base: "eighth" } },
                        outer: { multiple: 2, duration: { base: "eighth" } },
                        content: [
                          { duration: { base: "eighth" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
                          { duration: { base: "eighth" }, notes: [{ pitch: { step: "G", octave: 5 } }] },
                          { duration: { base: "eighth" }, notes: [{ pitch: { step: "A", octave: 5 } }] },
                        ],
                      },
                      { duration: { base: "half" }, notes: [{ pitch: { step: "B", octave: 5 } }] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Eighth-note triplets",
};

export const Sextuplets: StoryObj = {
  render: () => {
    const mnx = JSON.stringify(
      {
        mnx: { version: 1 },
        global: { measures: [{ time: { count: 4, unit: 4 } }] },
        parts: [
          {
            measures: [
              {
                clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
                sequences: [
                  {
                    content: [
                      {
                        type: "tuplet",
                        inner: { multiple: 6, duration: { base: "quarter" } },
                        outer: { multiple: 4, duration: { base: "quarter" } },
                        content: [
                          { duration: { base: "quarter" }, notes: [{ pitch: { step: "C", octave: 5 } }] },
                          { duration: { base: "quarter" }, notes: [{ pitch: { step: "D", octave: 5 } }] },
                          { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 5 } }] },
                          { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
                          { duration: { base: "quarter" }, notes: [{ pitch: { step: "G", octave: 5 } }] },
                          { duration: { base: "quarter" }, notes: [{ pitch: { step: "A", octave: 5 } }] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    );
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "6:4 sextuplet",
};
