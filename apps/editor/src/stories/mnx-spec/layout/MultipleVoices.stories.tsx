import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "MNX Spec/Rhythm & Beaming/Multiple Voices",
  component: ScorePreview,
};

export default meta;

export const TwoVoices: StoryObj = {
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
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "E", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "F", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "G", octave: 5 } }] },
                      { duration: { base: "quarter" }, notes: [{ pitch: { step: "B", octave: 4 } }] },
                    ],
                  },
                  {
                    content: [
                      { duration: { base: "half" }, notes: [{ pitch: { step: "C", octave: 4 } }] },
                      { duration: { base: "half" }, notes: [{ pitch: { step: "G", octave: 3 } }] },
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
  name: "Two voices on one staff",
};
