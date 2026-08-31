import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Dynamics & Tempo/Tempo",
  component: ScorePreview,
};

export default meta;

export const QuarterAt120: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 120, value: { base: "quarter" } }],
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Quarter = 120",
};

export const TempoChange: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          tempos: [{ bpm: 200, value: { base: "quarter" } }],
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "G", octave: 4 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
        {
          tempos: [{ bpm: 80, value: { base: "half" } }],
          voices: [
            [
              { duration: "half", notes: [{ step: "C", octave: 5 }] },
              { duration: "half", notes: [{ step: "G", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Tempo change (quarter = 200 to half = 80)",
};
