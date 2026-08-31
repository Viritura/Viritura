import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { buildSingleMeasure } from "../../storyFixtures/buildMnx";

const meta: Meta = {
  title: "Engraving Behavior/Articulations & Marks/Fermata Placement",
  component: ScorePreview,
};

export default meta;

export const LowNote: StoryObj = {
  render: () => {
    // A whole note below the staff (Db4, as in Rhapsody Violin I m14). With no
    // notes/stem above the staff, the fermata sits at its default placement —
    // ~1sp above the top staff line, not floating high above it.
    const mnx = buildSingleMeasure([{ duration: "whole", fermata: {}, notes: [{ step: "D", octave: 4, alter: -1 }] }]);
    return <ScorePreview mnxJson={mnx} />;
  },
  name: "Fermata above a low note",
};
