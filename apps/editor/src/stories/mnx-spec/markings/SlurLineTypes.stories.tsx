import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Slurs, Ties & Spanners/Slurs/Line Types",
  component: ScorePreview,
};

export default meta;

const lineTypes = ["solid", "dashed", "dotted"] as const;

/** Solid, dashed, and dotted slurs � one per measure. */
export const AllLineTypes: StoryObj = {
  render: () => {
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              {
                id: "ev1",
                duration: "half",
                notes: [{ step: "C", octave: 5 }],
                slurs: [{ target: "ev2", side: "up" }],
              },
              { id: "ev2", duration: "half", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
        {
          voices: [
            [
              {
                id: "ev3",
                duration: "half",
                notes: [{ step: "C", octave: 5 }],
                slurs: [{ target: "ev4", side: "up", lineType: "dashed" }],
              },
              { id: "ev4", duration: "half", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
        {
          voices: [
            [
              {
                id: "ev5",
                duration: "half",
                notes: [{ step: "C", octave: 5 }],
                slurs: [{ target: "ev6", side: "up", lineType: "dotted" }],
              },
              { id: "ev6", duration: "half", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Solid, dashed, and dotted slurs",
};

type InteractiveArgs = {
  lineType: (typeof lineTypes)[number];
};

/** Pick a slur line type with Storybook controls. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try slur line types",
  args: {
    lineType: "solid",
  },
  argTypes: {
    lineType: {
      control: { type: "select" },
      options: [...lineTypes],
    },
  },
  render: ({ lineType }) => {
    const slurProps: { target: string; side: string; lineType?: string } = { target: "ev2", side: "up" };
    if (lineType !== "solid") slurProps.lineType = lineType;
    const mnx = buildMnx({
      measures: [
        {
          time: { count: 4, unit: 4 },
          voices: [
            [
              { id: "ev1", duration: "half", notes: [{ step: "C", octave: 5 }], slurs: [slurProps] },
              { id: "ev2", duration: "half", notes: [{ step: "E", octave: 5 }] },
            ],
          ],
        },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
