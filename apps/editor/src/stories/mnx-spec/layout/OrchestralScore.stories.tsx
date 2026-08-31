import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import orchestralMnx from "../../../../../../packages/format/fixtures/mnx/orchestral-template.mnx?raw";

const meta: Meta = {
  title: "Engraving Behavior/Staves, Systems & Scores/Large Scores/Orchestral Score",
  component: ScorePreview,
};

export default meta;

export const FullScore: StoryObj = {
  render: () => <ScorePreview mnxJson={orchestralMnx} />,
  name: "Full orchestral score (24 parts)",
};
