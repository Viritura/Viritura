import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";

const meta: Meta = {
  title: "Viritura Extensions/Meter & Layout/Repeat Boundaries",
  component: ScorePreview,
};

export default meta;

const score = JSON.stringify({
  mnx: { version: 1 },
  global: {
    measures: [
      { time: { count: 4, unit: 4 } },
      { time: { count: 3, unit: 4 }, repeatStart: {} },
      {
        key: { fifths: 1 },
        time: { count: 4, unit: 4 },
        ending: { duration: 1, numbers: [1] },
        repeatEnd: {},
      },
      { ending: { duration: 1, numbers: [2] } },
    ],
  },
  parts: [
    {
      measures: [
        {
          clefs: [{ clef: { sign: "G", staffPosition: -2 } }],
          sequences: [{ content: [{ duration: { base: "whole" }, rest: {} }] }],
        },
        {
          sequences: [
            { content: [{ duration: { base: "half", dots: 1 }, notes: [{ pitch: { step: "F", octave: 4 } }] }] },
          ],
        },
        {
          clefs: [{ clef: { sign: "F", staffPosition: 2 } }],
          sequences: [
            {
              content: [
                { duration: { base: "half", dots: 1 }, notes: [{ pitch: { step: "F", octave: 4, alter: 1 } }] },
              ],
            },
          ],
        },
        {
          sequences: [
            { content: [{ duration: { base: "half", dots: 1 }, notes: [{ pitch: { step: "C", octave: 3 } }] }] },
          ],
        },
      ],
    },
  ],
});

export const RepeatReturnAndFollowingClef: StoryObj = {
  render: () => <ScorePreview mnxJson={score} />,
};
