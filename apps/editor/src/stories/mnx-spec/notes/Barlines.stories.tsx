import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildMnx, type MeasureArgs } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "MNX Spec/Barlines, Repeats & Navigation/Barlines",
  component: ScorePreview,
};

export default meta;

const barlineTypes = [
  "regular",
  "double",
  "dashed",
  "dotted",
  "heavy",
  "heavyLight",
  "heavyHeavy",
  "tick",
  "short",
  "final",
  "noBarline",
] as const;

/** Every barline type in one multi-measure view. */
export const AllBarlineTypes: StoryObj = {
  render: () => {
    const measures: MeasureArgs[] = barlineTypes.map((bt, i) => ({
      ...(i === 0 ? { time: { count: 4, unit: 4 } } : {}),
      barline: { type: bt },
      voices: [[{ duration: "whole", rest: true }]],
    }));
    const mnx = buildMnx({ measures });
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Barlines between measures",
};

type InteractiveArgs = {
  barlineType: (typeof barlineTypes)[number];
};

/** Pick a barline type to preview it on the second measure. */
export const Interactive: StoryObj<InteractiveArgs> = {
  name: "Try barline types",
  args: {
    barlineType: "double",
  },
  argTypes: {
    barlineType: {
      control: { type: "select" },
      options: [...barlineTypes],
    },
  },
  render: ({ barlineType }) => {
    const mnx = buildMnx({
      measures: [
        { time: { count: 4, unit: 4 }, voices: [[{ duration: "whole", rest: true }]] },
        { barline: { type: barlineType }, voices: [[{ duration: "whole", rest: true }]] },
      ],
    });
    return <ScorePreview mnxJson={mnx} />;
  },
};
