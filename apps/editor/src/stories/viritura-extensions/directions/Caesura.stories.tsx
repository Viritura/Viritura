import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Breaks & Pauses/Caesuras",
  component: ScorePreview,
};

export default meta;

export const DefaultCaesura: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { duration: "quarter", notes: [{ step: "C", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "D", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "E", octave: 5 }] },
              { duration: "quarter", notes: [{ step: "F", octave: 5 }], virituraMarkings: { caesura: {} } },
            ],
          ],
        },
        {
          voices: [
            [
              { duration: "half", notes: [{ step: "G", octave: 5 }] },
              { duration: "half", notes: [{ step: "A", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Default caesura",
};

export const AllStyles: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }], virituraMarkings: { caesura: {} } }]],
        },
        {
          voices: [
            [
              {
                duration: "whole",
                notes: [{ step: "D", octave: 5 }],
                virituraMarkings: { caesura: { style: "thick" } },
              },
            ],
          ],
        },
        {
          voices: [
            [
              {
                duration: "whole",
                notes: [{ step: "E", octave: 5 }],
                virituraMarkings: { caesura: { style: "short" } },
              },
            ],
          ],
        },
        {
          voices: [
            [
              {
                duration: "whole",
                notes: [{ step: "F", octave: 5 }],
                virituraMarkings: { caesura: { style: "curved" } },
              },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Default, thick, short, and curved caesuras",
};
