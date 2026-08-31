import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import beethovenMnx from "../../../../../../packages/format/fixtures/mnx/beethoven-5-finale.mnx?raw";

const meta: Meta = {
  title: "Engraving Behavior/Staves, Systems & Scores/Large Scores/Beethoven's Fifth Finale",
  component: ScorePreview,
};

export default meta;

export const FullScore: StoryObj = {
  render: () => <ScorePreview mnxJson={beethovenMnx} />,
  name: "Beethoven's Fifth finale (23 parts, 12 measures)",
};
