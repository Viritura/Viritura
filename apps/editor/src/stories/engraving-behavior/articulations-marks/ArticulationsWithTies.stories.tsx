import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Engraving Behavior/Articulations & Marks/Articulations with Ties",
  component: ScorePreview,
};

export default meta;

/** Accents move outward when a continuing tie occupies the same side. */
export const AccentsWithTies: StoryObj = {
  render: () => {
    const mnx = buildSingleMeasure([
      {
        duration: "quarter",
        markings: { accent: {} },
        notes: [{ id: "low-source", step: "C", octave: 4, ties: [{ target: "low-target" }] }],
      },
      { duration: "quarter", notes: [{ id: "low-target", step: "C", octave: 4 }] },
      {
        duration: "quarter",
        markings: { accent: {} },
        notes: [{ id: "high-source", step: "E", octave: 5, ties: [{ target: "high-target" }] }],
      },
      { duration: "quarter", notes: [{ id: "high-target", step: "E", octave: 5 }] },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Accents clear same-side ties",
};
