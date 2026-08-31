import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Viritura Extensions/Techniques & Ornaments/Fingerings",
  component: ScorePreview,
};

export default meta;

export const BasicFingerings: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure([
      { duration: "quarter", virituraMarkings: { fingerings: [{ finger: 1 }] }, notes: [{ step: "C", octave: 5 }] },
      { duration: "quarter", virituraMarkings: { fingerings: [{ finger: 2 }] }, notes: [{ step: "D", octave: 5 }] },
      { duration: "quarter", virituraMarkings: { fingerings: [{ finger: 3 }] }, notes: [{ step: "E", octave: 5 }] },
      { duration: "quarter", virituraMarkings: { fingerings: [{ finger: 4 }] }, notes: [{ step: "F", octave: 5 }] },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Fingerings 1-4",
};
