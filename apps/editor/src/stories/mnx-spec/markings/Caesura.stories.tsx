import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Articulations & Marks/Caesura",
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
              { duration: "quarter", notes: [{ step: "F", octave: 5 }], markings: { caesura: {} } },
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
          voices: [[{ duration: "whole", notes: [{ step: "C", octave: 5 }], markings: { caesura: {} } }]],
        },
        {
          voices: [
            [
              {
                duration: "whole",
                notes: [{ step: "D", octave: 5 }],
                markings: { caesura: { shape: "thick" } },
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
                markings: { caesura: { shape: "short" } },
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
                markings: { caesura: { shape: "curved" } },
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

export const AllMarksCounts: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [{ duration: "whole", notes: [{ step: "C", octave: 5 }], markings: { caesura: { shape: "normal" } } }],
          ],
        },
        {
          voices: [
            [
              {
                duration: "whole",
                notes: [{ step: "D", octave: 5 }],
                markings: { caesura: { shape: "normal", marks: 1 } },
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
                markings: { caesura: { shape: "thick", marks: 1 } },
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
                markings: { caesura: { shape: "curved", marks: 1 } },
              },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Two-mark default vs. single-mark variants (SMuFL only defines a single-stroke glyph)",
};
