import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Engraving Behavior/Articulations & Marks/Ornament Clearance",
  component: ScorePreview,
};

export default meta;

export const TrillWithArticulation: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure([
      {
        duration: "half",
        markings: { accent: {} },
        virituraMarkings: { trill: {} },
        notes: [{ step: "D", octave: 5 }],
      },
      { duration: "half", notes: [{ step: "C", octave: 5 }] },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Trill with articulation",
};
