import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import { ForcedAbove as forcedAbove, ForcedBelow as forcedBelow } from "./slurCases";

const meta: Meta = {
  title: "MNX Spec/Slurs, Ties & Spanners/Slurs/Placement",
  component: ScorePreview,
};

export default meta;

export const ForcedAbove: StoryObj = forcedAbove;
export const ForcedBelow: StoryObj = forcedBelow;
