import type { Meta, StoryObj } from "@storybook/react-vite";
import rehearsals from "../../../../../packages/format/fixtures/mnx/rehearsal-marks.mnx?raw";
import { ClickPage } from "../../click";

const meta: Meta<typeof ClickPage> = {
  title: "App/Click",
  component: ClickPage,
  parameters: { layout: "fullscreen" },
};

export default meta;
export const OpenMnx: StoryObj<typeof ClickPage> = {};

export const ScoreAndFloatingTransport: StoryObj<typeof ClickPage> = {
  play: async ({ canvasElement }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[aria-label="MNX file"]');
    if (!input) throw new Error("The MNX file input is missing");
    const files = new DataTransfer();
    files.items.add(new File([rehearsals], "rehearsals.mnx", { type: "application/json" }));
    input.files = files.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  },
};
