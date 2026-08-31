import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Techniques & Ornaments/Trills",
  component: ScorePreview,
};

export default meta;

export const SimpleTrill: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure([
      { duration: "half", virituraMarkings: { trill: {} }, notes: [{ step: "E", octave: 5 }] },
      { duration: "half", notes: [{ step: "C", octave: 5 }] },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Simple trill",
};
