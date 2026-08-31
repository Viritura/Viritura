import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Text & Labels/Measure Numbers",
  component: ScorePreview,
  argTypes: {
    measureNumber: {
      control: { type: "number", min: 0, max: 100, step: 1 },
      description: "Custom measure number (MNX number property)",
    },
  },
  args: {
    measureNumber: 5,
  },
};

export default meta;

type MeasureNumberArgs = { measureNumber: number };

export const Default: StoryObj<MeasureNumberArgs> = {
  render: (args) => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          number: args.measureNumber,
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }] },
            ],
          ],
        },
        {
          voices: [[{ duration: "whole", notes: [{ step: "G", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};

export const PickupBar: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          number: 0,
          voices: [[{ duration: "quarter", notes: [{ step: "G", octave: 4 }] }]],
        },
        {
          number: 1,
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }] }]],
        },
        {
          number: 2,
          voices: [[{ duration: "whole", notes: [{ step: "D", octave: 5 }] }]],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
