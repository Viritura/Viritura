import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScorePreview } from "../../storyFixtures/ScorePreview";
import crossJumpMnx from "../../../../../../packages/format/fixtures/mnx/cross-jump-ties.mnx?raw";

const meta: Meta = {
  title: "MNX Spec/Slurs, Ties & Spanners/Ties/Repeat and Alternate Ending",
  component: ScorePreview,
};
export default meta;

export const ChordThroughRepeatAndSecondEnding: StoryObj = {
  render: () => <ScorePreview mnxJson={crossJumpMnx} />,
  name: "Explicit crossJump chord ties",
};
