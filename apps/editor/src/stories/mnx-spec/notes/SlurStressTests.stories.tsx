import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { StressGrid as stressGrid } from "./slurCases";

const meta: Meta = {
  title: "Engraving Behavior/Slurs & Ties/Stress Cases",
  component: ScorePreview,
};

export default meta;

export const StressGrid: StoryObj = stressGrid;
