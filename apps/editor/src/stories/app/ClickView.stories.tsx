import type { Meta, StoryObj } from "@storybook/react-vite";
import rehearsals from "../../../../../packages/format/fixtures/mnx/rehearsal-marks.mnx?raw";
import { ClickView } from "../../click";

const meta: Meta<typeof ClickView> = {
  title: "App/Click",
  component: ClickView,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ display: "flex", height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
export const NoScore: StoryObj<typeof ClickView> = { args: { mnx: "" } };

export const ScoreAndFloatingTransport: StoryObj<typeof ClickView> = { args: { mnx: rehearsals } };
