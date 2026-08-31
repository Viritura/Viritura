import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Engraving Behavior/Articulations & Marks/Combined Markings",
  component: ScorePreview,
};

export default meta;

/** Bow direction combined with a slur and accent. */
export const WithOtherMarkings: StoryObj = {
  name: "Bowing marks with articulations",
  render: () => {
    const mnx = buildSingleMeasure([
      {
        duration: "quarter",
        markings: { bowDirection: { direction: "down" }, accent: {} },
        notes: [{ step: "E", octave: 5 }],
      },
      {
        duration: "quarter",
        markings: { bowDirection: { direction: "up" }, staccato: {} },
        notes: [{ step: "F", octave: 5 }],
      },
      {
        duration: "quarter",
        markings: { bowDirection: { direction: "down" }, tenuto: {} },
        notes: [{ step: "G", octave: 5 }],
      },
      {
        duration: "quarter",
        markings: { bowDirection: { direction: "up" }, strongAccent: {} },
        notes: [{ step: "A", octave: 5 }],
      },
    ]);
    return <ScorePreview mnxJson={mnx} />;
  },
};
