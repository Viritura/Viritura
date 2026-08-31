import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Text & Labels/Lyrics",
  component: ScorePreview,
};

export default meta;

export const BasicLyrics: StoryObj = {
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
                        duration: { base: "quarter" },
                        lyrics: { lines: { "1": { text: "Are" } } },
                        notes: [{ pitch: { step: "C", octave: 5 } }],
                      },
                      {
                        duration: { base: "quarter" },
                        lyrics: { lines: { "1": { text: "you" } } },
                        notes: [{ pitch: { step: "D", octave: 5 } }],
                      },
                      {
                        duration: { base: "quarter" },
                        lyrics: { lines: { "1": { type: "start", text: "sleep" } } },
                        notes: [{ pitch: { step: "E", octave: 5 } }],
                      },
                      {
                        duration: { base: "quarter" },
                        lyrics: { lines: { "1": { type: "end", text: "ing?" } } },
                        notes: [{ pitch: { step: "C", octave: 5 } }],
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
  name: "Basic lyrics with syllable hyphenation",
};
